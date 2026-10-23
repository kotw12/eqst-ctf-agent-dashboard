import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ownedSkillPaths } from './owned-skills.mjs';
import { COMMON_INSTRUCTIONS } from '../core/instructions.mjs';

import { DEFAULT_MODEL, LIGHTWEIGHT_MODEL, MODEL_CONTEXT_LIMITS } from '../core/model-policy.mjs';

export const BASE_CONFIG = `model = "${DEFAULT_MODEL}"
model_reasoning_effort = "low"
model_context_window = ${MODEL_CONTEXT_LIMITS[DEFAULT_MODEL].contextWindow}
model_auto_compact_token_limit = ${MODEL_CONTEXT_LIMITS[DEFAULT_MODEL].autoCompactTokenLimit}
model_auto_compact_token_limit_scope = "total"
sandbox_mode = "workspace-write"
approval_policy = "on-request"
cli_auth_credentials_store = "file"
check_for_update_on_startup = true
daybreak = true
service_tier = "default"

[agents]
enabled = false
default_subagent_model = "${LIGHTWEIGHT_MODEL}"
default_subagent_reasoning_effort = "low"

[features]
cli_daybreak = true

[tui]
terminal_title = []
notifications = ["agent-turn-complete", "approval-requested"]
`;

function absolutePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\0') || !path.isAbsolute(value)) {
    throw new Error(`${label} must be a nonempty absolute path; choose a separate Codex home.`);
  }
  return path.normalize(value);
}

function metadata(filename, follow = true) {
  try {
    return follow ? fs.statSync(filename) : fs.lstatSync(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot inspect ${filename}: ${error.code ?? error.message}. Check its path and permissions.`, { cause: error });
  }
}

// Resolve existing ancestors as well as dangling symlinks before any creation.
function canonicalPath(filename, links = 0) {
  if (links > 40) throw new Error(`Too many symbolic links resolving ${filename}; choose a direct directory path.`);
  const entry = metadata(filename, false);
  if (entry?.isSymbolicLink()) {
    return canonicalPath(path.resolve(path.dirname(filename), fs.readlinkSync(filename)), links + 1);
  }
  if (entry) {
    try {
      return fs.realpathSync(filename);
    } catch (error) {
      throw new Error(`Cannot resolve ${filename}: ${error.code ?? error.message}. Check its symbolic links.`, { cause: error });
    }
  }
  const parent = path.dirname(filename);
  if (parent === filename) return filename;
  return path.join(canonicalPath(parent, links), path.basename(filename));
}

function within(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function validateHome(home, userHome, env) {
  const selected = canonicalPath(absolutePath(home, 'CTF_CODEX_HOME'));
  const protectedHomes = new Set([
    path.join(absolutePath(userHome, 'userHome'), '.codex'),
    path.join(os.homedir(), '.codex'),
  ]);
  if (env.CODEX_HOME) protectedHomes.add(path.resolve(env.CODEX_HOME));
  for (const original of protectedHomes) {
    const canonical = canonicalPath(original);
    if (within(canonical, selected) || within(selected, canonical)) {
      throw new Error(`Isolated Codex home ${selected} overlaps the general Codex home (${original}). Set CTF_CODEX_HOME to a separate directory, such as ~/.codex-ctf.`);
    }
  }
  return selected;
}

export function getCodexHome(env = process.env) {
  return validateHome(env.CTF_CODEX_HOME ?? path.join(os.homedir(), '.codex-ctf'), os.homedir(), env);
}

function skillPaths(home, userHome) {
  const roots = [path.join(userHome, '.agents', 'skills'), path.join(userHome, '.codex', 'skills')];
  const systemRoots = [path.join(home, 'skills', '.system'), path.join(userHome, '.codex', 'skills', '.system')]
    .map((directory) => canonicalPath(directory));
  const found = new Set();

  function visit(directory, ancestors) {
    const info = metadata(directory);
    if (!info) return;
    if (!info.isDirectory()) {
      throw new Error(`Skill search path ${directory} is not a directory; move it aside or correct its path.`);
    }
    const canonical = canonicalPath(directory);
    if (systemRoots.some((root) => within(root, canonical)) || ancestors.has(canonical)) return;
    const nextAncestors = new Set(ancestors).add(canonical);
    const manifest = path.join(directory, 'SKILL.md');
    if (metadata(manifest)?.isFile()) {
      const resolvedManifest = canonicalPath(manifest);
      if (systemRoots.some((root) => within(root, resolvedManifest))) return;
      found.add(manifest);
      found.add(resolvedManifest);
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Cannot discover user skills in ${directory}: ${error.code ?? error.message}. Check directory permissions before launching.`, { cause: error });
    }
    for (const entry of entries) {
      if (entry.name === '.system') continue;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && metadata(child)?.isDirectory())) {
        visit(child, nextAncestors);
      }
    }
  }

  for (const root of roots) visit(root, new Set());
  return [...found].sort();
}

function tomlString(value) {
  return JSON.stringify(value).replaceAll('\u007f', '\\u007f');
}

function disabledSkills(paths, enabled = []) {
  const entries = [
    ...paths.map((manifest) => `{path=${tomlString(manifest)},enabled=false}`),
    ...enabled.map((manifest) => `{path=${tomlString(manifest)},enabled=true}`),
  ];
  return `[${entries.join(',')}]`;
}

export function isolationOverrides({ home, userHome = os.homedir() }) {
  const isolated = validateHome(home, userHome, process.env);
  const enabled = ownedSkillPaths(isolated);
  const allowed = new Set(enabled);
  const disabled = skillPaths(isolated, absolutePath(userHome, 'userHome')).filter(manifest => !allowed.has(manifest));
  return [`skills.config=${disabledSkills(disabled, enabled)}`];
}

function createFile(filename, content, created) {
  let descriptor;
  try {
    descriptor = fs.openSync(filename, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      const existing = metadata(filename, false);
      if (existing?.isFile()) return;
      throw new Error(`Refusing existing non-regular file ${filename}; replace it with a private regular file yourself. Nothing was overwritten.`, { cause: error });
    }
    throw new Error(`Cannot create ${filename}: ${error.code ?? error.message}. Check the isolated home permissions.`, { cause: error });
  }
  try {
    fs.writeFileSync(descriptor, content, 'utf8');
    created.push(filename);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function ensureCodexHome({ home = getCodexHome(), userHome = os.homedir() } = {}) {
  const isolated = validateHome(home, userHome, process.env);
  const userDirectory = absolutePath(userHome, 'userHome');
  const created = [];
  const existed = metadata(isolated, false);
  if (existed && !existed.isDirectory()) {
    throw new Error(`Isolated Codex home ${isolated} is not a directory; choose another CTF_CODEX_HOME.`);
  }
  // Discover before writing, so inaccessible user-skill directories fail closed.
  const paths = skillPaths(isolated, userDirectory);
  try {
    const firstCreated = fs.mkdirSync(isolated, { recursive: true, mode: 0o700 });
    if (firstCreated !== undefined) created.push(isolated);
  } catch (error) {
    throw new Error(`Cannot create isolated Codex home ${isolated}: ${error.code ?? error.message}. Check its parent directory permissions.`, { cause: error });
  }
  // Revalidate after mkdir to reject a redirected home before creating files.
  if (validateHome(isolated, userDirectory, process.env) !== isolated) {
    throw new Error(`Isolated Codex home ${isolated} changed while creating it; retry using a stable directory.`);
  }
  const configPath = path.join(isolated, 'config.toml');
  const instructionsPath = path.join(isolated, 'AGENTS.md');
  const writableToolRoots = ['.bsk', '.cache', '.local/share/seal-tools', '.local/state/seal-tools']
    .map(relative => tomlString(path.join(userDirectory, relative)));
  const sandboxConfig = `[sandbox_workspace_write]\nnetwork_access = true\nwritable_roots = [${writableToolRoots.join(', ')}]\n`;
  createFile(configPath, `${BASE_CONFIG}\n${sandboxConfig}\n[skills]\nconfig = ${disabledSkills(paths)}\n`, created);
  createFile(instructionsPath, COMMON_INSTRUCTIONS, created);
  return { home: isolated, created, configPath, instructionsPath };
}

export function nativeEnvironment(home, env = process.env) {
  absolutePath(home, 'CODEX_HOME');
  const result = { ...env, CODEX_HOME: home };
  for (const key of Object.keys(result)) {
    if (key.startsWith('ORCA_')) delete result[key];
  }
  return result;
}
