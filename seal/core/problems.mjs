import { constants } from "node:fs";
import {
  link, lstat, mkdir, open, readdir, realpath, unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const CONTROLS = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function safeText(value, label, maximum = 200) {
  check(typeof value === "string" && value.trim(), `${label} must be nonempty text.`);
  check(value.length <= maximum && !CONTROLS.test(value), `${label} must be at most ${maximum} characters without control characters.`);
  return value.trim().normalize("NFKC");
}

export function problemSlug(name) {
  const normalized = safeText(name, "Problem name");
  const slug = [...normalized.toLowerCase()
    .replace(/[\\/]+/g, "-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")]
    .slice(0, 80).join("")
    .replace(/^[-._]+|[-._]+$/g, "");
  check(slug && slug !== "." && slug !== "..", "Problem name does not produce a safe folder name.");
  return slug;
}

async function directory(directoryPath, { create = false, label = "Directory" } = {}) {
  let created = false;
  if (create) {
    try { await mkdir(directoryPath, { mode: 0o700 }); created = true; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  const info = await lstat(directoryPath);
  check(info.isDirectory() && !info.isSymbolicLink(), `${label} must be a real directory: ${directoryPath}`);
  check(await realpath(directoryPath) === directoryPath, `${label} escapes through a symbolic link: ${directoryPath}`);
  return created;
}

async function openRegular(filename, flags = constants.O_RDONLY) {
  const before = await lstat(filename);
  check(before.isFile() && !before.isSymbolicLink(), `Expected a regular file: ${filename}`);
  const handle = await open(filename, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const after = await handle.stat();
    check(after.isFile() && after.dev === before.dev && after.ino === before.ino, `Regular file changed while opening: ${filename}`);
    return { handle, info: after };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function validateRegularFile(filename) {
  const { handle } = await openRegular(filename);
  await handle.close();
}

async function regularFile(filename, { maximum = 1024 * 1024 } = {}) {
  const { handle, info } = await openRegular(filename);
  try {
    check(info.size <= maximum, `Expected a bounded regular file: ${filename}`);
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function createFile(filename, content, created) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    try { await handle.writeFile(content, "utf8"); }
    finally { await handle.close(); }
    try {
      await link(temporary, filename);
      created.push(filename);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await validateRegularFile(filename);
    }
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

async function publishJson(filename, value, created) {
  await createFile(filename, `${JSON.stringify(value, null, 2)}\n`, created);
}

function markerValid(marker, slug) {
  check(marker?.version === 1 && typeof marker.id === "string" && /^[0-9a-f-]{36}$/.test(marker.id), "Invalid problem identity.");
  check(marker.slug === slug && typeof marker.name === "string" && marker.name.trim(), "Problem metadata does not match its folder.");
  check(typeof marker.category === "string" && marker.category.trim(), "Invalid problem category metadata.");
  check(typeof marker.createdAt === "string" && Number.isFinite(Date.parse(marker.createdAt)), "Invalid problem creation time.");
}

export async function loadProblem(problemRoot) {
  const root = path.resolve(problemRoot);
  await directory(root, { label: "Problem folder" });
  const slug = path.basename(root);
  const sealDir = path.join(root, ".seal");
  await directory(sealDir, { label: "Problem metadata folder" });
  const markerPath = path.join(sealDir, "problem.json");
  const marker = JSON.parse(await regularFile(markerPath));
  markerValid(marker, slug);
  const result = {
    ...marker,
    root,
    markerPath,
    challengePath: path.join(root, "challenge.md"),
    attachmentsDir: path.join(root, "attachments"),
    solveDir: path.join(root, "solve"),
    artifactsDir: path.join(root, "artifacts"),
    notesPath: path.join(root, "NOTES.md"),
    writeupPath: path.join(root, "writeup.md"),
  };
  await validateRegularFile(result.challengePath);
  await validateRegularFile(result.notesPath);
  for (const key of ["attachmentsDir", "solveDir", "artifactsDir"]) await directory(result[key], { label: key });
  return result;
}

export async function initProblem(workspace, name, { category = "unknown" } = {}) {
  const workspaceRoot = await realpath(workspace);
  await directory(workspaceRoot, { label: "CTF workspace" });
  const displayName = safeText(name, "Problem name");
  const safeCategory = safeText(category, "Problem category", 100);
  const slug = problemSlug(displayName);
  const root = path.join(workspaceRoot, slug);
  const created = [];
  if (await directory(root, { create: true, label: "Problem folder" })) created.push(root);
  const sealDir = path.join(root, ".seal");
  if (await directory(sealDir, { create: true, label: "Problem metadata folder" })) created.push(sealDir);
  const markerPath = path.join(sealDir, "problem.json");
  const marker = { version: 1, id: randomUUID(), name: displayName, slug, category: safeCategory, createdAt: new Date().toISOString() };
  await publishJson(markerPath, marker, created);
  const existing = JSON.parse(await regularFile(markerPath));
  markerValid(existing, slug);
  check(existing.name === displayName, `Folder ${slug} already belongs to problem ${JSON.stringify(existing.name)}.`);

  for (const child of ["attachments", "solve", "artifacts"]) {
    const childPath = path.join(root, child);
    if (await directory(childPath, { create: true, label: `${child} folder` })) created.push(childPath);
  }
  await createFile(path.join(root, "challenge.md"), `# ${existing.name}\n\n- Category: ${existing.category}\n- Source: not recorded\n- Access: not recorded\n- Flag format: not recorded\n\n## Statement\n\nNo statement recorded yet.\n`, created);
  await createFile(path.join(root, "NOTES.md"), `# Shared progress — ${existing.name}\n\n- Status: new\n- Candidate: none\n\n## Confirmed facts\n\n## Attempts\n\n## Shared updates\n\n## Next actions\n`, created);
  return { problem: await loadProblem(root), created };
}

export async function listProblems(workspace) {
  const workspaceRoot = await realpath(workspace);
  await directory(workspaceRoot, { label: "CTF workspace" });
  const problems = [];
  for (const entry of await readdir(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const root = path.join(workspaceRoot, entry.name);
    try { problems.push(await loadProblem(root)); }
    catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code) || /Problem metadata folder|Expected a bounded regular file/.test(error.message)) continue;
      throw error;
    }
  }
  return problems.sort((left, right) => left.slug.localeCompare(right.slug));
}

export async function findProblemRoot(start) {
  let current = await realpath(start);
  while (true) {
    const marker = path.join(current, ".seal", "problem.json");
    try {
      const info = await lstat(marker);
      if (info.isFile() && !info.isSymbolicLink()) return current;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function appendProblemNote(workspace, selector, message) {
  const text = safeText(message, "Shared note", 8192);
  let problem;
  if (selector) {
    const slug = problemSlug(selector);
    problem = await loadProblem(path.join(await realpath(workspace), slug));
  } else {
    const root = await findProblemRoot(workspace);
    check(root, "No problem folder found; supply its problem name.");
    problem = await loadProblem(root);
  }
  const update = `\n### ${new Date().toISOString()}\n\n${text}\n`;
  const { handle } = await openRegular(problem.notesPath, constants.O_WRONLY | constants.O_APPEND);
  try {
    await handle.writeFile(update, "utf8");
  } finally {
    await handle.close();
  }
  return { problem, notesPath: problem.notesPath };
}
