import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { OWNED_SKILL_NAMES } from "../core/skill-names.mjs";

const SOURCE_ROOT = fileURLToPath(new URL("../skills/", import.meta.url));
const MARKER_LIMIT = 16 * 1024;

function markerPath(home) {
  return path.join(home, ".seal-owned-skills.json");
}

function readMarker(home) {
  const filename = markerPath(home);
  const info = existing(filename);
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.size > MARKER_LIMIT) {
    throw new Error(`Refusing invalid owned-skill metadata at ${filename}; move it aside explicitly.`);
  }
  let fd;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size > MARKER_LIMIT) throw new Error("metadata changed while opening");
    const data = fs.readFileSync(fd);
    if (data.length > MARKER_LIMIT) throw new Error("metadata exceeds size limit");
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
    if (value?.schemaVersion !== 1 || !value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)
      || Object.keys(value.entries).some(name => !OWNED_SKILL_NAMES.includes(name)
        || typeof value.entries[name]?.source !== "string" || !path.isAbsolute(value.entries[name].source)
        || !/^[a-f0-9]{64}$/.test(value.entries[name].manifestSha256))) throw new Error("unsupported metadata schema");
    return value;
  } catch (error) {
    throw new Error(`Refusing invalid owned-skill metadata at ${filename}: ${error.message}; move it aside explicitly.`, { cause: error });
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function manifestHash(filename) {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

function saveMarker(home, previous, definitions) {
  const filename = markerPath(home);
  const entries = Object.fromEntries(definitions.map(item => {
    const name = path.basename(item.directory);
    const recorded = previous?.entries?.[name];
    // Re-registering a current source must not bless user edits as a release
    // baseline: a later upgrade still needs to recognize those changed bytes.
    return [name, recorded?.source === item.directory ? recorded
      : { source: item.directory, manifestSha256: manifestHash(item.manifest) }];
  }));
  const metadata = { schemaVersion: 1, entries };
  if (JSON.stringify(metadata) === JSON.stringify(previous)) return;
  const temporary = path.join(home, `.seal-owned-skills-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(metadata)}\n`, { flag: "wx", mode: 0o600 });
    if (JSON.stringify(readMarker(home)) !== JSON.stringify(previous)) {
      throw new Error(`Owned-skill metadata changed during registration: ${filename}. Retry without replacing user data.`);
    }
    fs.renameSync(temporary, filename);
  } finally { if (existing(temporary)) fs.unlinkSync(temporary); }
}

function skillRoot(home) {
  if (typeof home !== "string" || !path.isAbsolute(home)) throw new Error("Skill home must be an absolute path.");
  return path.join(home, "skills");
}

function existing(filename) {
  try { return fs.lstatSync(filename); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function source(name) {
  const directory = fs.realpathSync(path.join(SOURCE_ROOT, name));
  const manifest = path.join(directory, "SKILL.md");
  if (!fs.statSync(manifest).isFile()) throw new Error(`Missing owned skill manifest: ${manifest}`);
  return { directory, manifest };
}

function unredirectedMissingSource(target) {
  let ancestor = target;
  let entry = existing(ancestor);
  if (entry) return false;
  while (!entry) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return false;
    ancestor = parent;
    entry = existing(ancestor);
  }
  return entry.isDirectory() && fs.realpathSync(ancestor) === ancestor;
}

function linkState(destination, expected, marker) {
  const entry = existing(destination);
  if (!entry) return "missing";
  if (!entry.isSymbolicLink()) {
    throw new Error(`Refusing to replace an existing non-owned skill at ${destination}. Preserve or move it explicitly first.`);
  }
  const name = path.basename(destination);
  const target = fs.readlinkSync(destination);
  const recorded = marker?.entries?.[name];
  const ownedTarget = path.isAbsolute(target) && path.normalize(target) === target
    && target.endsWith(`${path.sep}${path.join("skills", name)}`);
  let actual;
  try { actual = fs.realpathSync(destination); }
  catch (error) {
    // An in-place source move leaves the old absolute links dangling. A
    // recorded release may also have been removed by a package upgrade.
    // Never infer ownership from a basename alone or from a redirected path.
    const legacySource = path.join(path.dirname(SOURCE_ROOT), "codex", "skills", name);
    if (error.code === "ENOENT" && ownedTarget
      && (recorded?.source === target || (!recorded && target === legacySource))
      && unredirectedMissingSource(target)) return "compatible";
    throw new Error(`Refusing a broken or unreadable skill link without matching ownership at ${destination}. Preserve or move it explicitly first.`, { cause: error });
  }
  if (actual === expected) return "current";
  const previous = path.join(actual, "SKILL.md");
  const current = path.join(expected, "SKILL.md");
  if (ownedTarget && actual === target) {
    const prior = existing(previous);
    const next = existing(current);
    if (prior?.isFile() && !prior.isSymbolicLink() && prior.size <= 128 * 1024
      && next?.isFile() && !next.isSymbolicLink()
      && ((next.size === prior.size && fs.readFileSync(previous).equals(fs.readFileSync(current)))
        || (recorded?.source === actual && recorded.manifestSha256 === manifestHash(previous)))) return "compatible";
  }
  throw new Error(`Refusing to replace an existing non-owned skill at ${destination}. Preserve or move it explicitly first.`);
}

export function ownedSkillPaths(home) {
  const root = skillRoot(home);
  const entry = existing(root);
  if (!entry) return [];
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Owned skill storage must be a real directory: ${root}`);
  const marker = readMarker(home);
  const manifests = [];
  for (const name of OWNED_SKILL_NAMES) {
    const expected = source(name);
    const destination = path.join(root, name);
    if (linkState(destination, expected.directory, marker) === "current") {
      manifests.push(path.join(destination, "SKILL.md"), expected.manifest);
    }
  }
  return [...new Set(manifests)];
}

export function ensureOwnedSkills(home) {
  const root = skillRoot(home);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const entry = fs.lstatSync(root);
  if (!entry.isDirectory() || entry.isSymbolicLink() || fs.realpathSync(root) !== root) {
    throw new Error(`Owned skill storage must be a real directory: ${root}`);
  }
  const marker = readMarker(home);
  const definitions = OWNED_SKILL_NAMES.map(name => ({ ...source(name), destination: path.join(root, name) }));
  // Validate the complete set before changing any link, including ownership
  // proof for dangling links left by the source-layout or package upgrade.
  const states = definitions.map(item => {
    const entry = existing(item.destination);
    const target = entry?.isSymbolicLink() ? fs.readlinkSync(item.destination) : null;
    return { ...item, entry, target, state: linkState(item.destination, item.directory, marker) };
  });
  const created = [];
  const migrated = [];
  for (const item of states) {
    if (item.state === "current") continue;
    if (item.state === "compatible") {
      const temporary = path.join(root, `.seal-link-${randomUUID()}`);
      fs.symlinkSync(item.directory, temporary, "dir");
      try {
        const now = fs.lstatSync(item.destination);
        if (!now.isSymbolicLink() || now.dev !== item.entry.dev || now.ino !== item.entry.ino
          || fs.readlinkSync(item.destination) !== item.target) {
          throw new Error(`Skill link changed during migration: ${item.destination}. Retry without replacing user data.`);
        }
        fs.renameSync(temporary, item.destination);
        migrated.push(item.destination);
      } finally { if (existing(temporary)) fs.unlinkSync(temporary); }
      continue;
    }
    try { fs.symlinkSync(item.directory, item.destination, "dir"); created.push(item.destination); }
    catch (error) { if (error.code !== "EEXIST" || linkState(item.destination, item.directory, marker) !== "current") throw error; }
  }
  saveMarker(home, marker, definitions);
  return { created, migrated, paths: ownedSkillPaths(home) };
}
