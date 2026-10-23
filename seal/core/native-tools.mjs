import fs from 'node:fs';
import path from 'node:path';

const MANIFEST_LIMIT = 64 * 1024;
const SUPPORTED = new Set(['xxd', 'pngcheck', 'upx-ucl', 'rsvg-convert', 'stegseek']);

function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

export function privateToolInstallations({ commands, env, userHome }) {
  const selected = new Set(commands.filter(command => SUPPORTED.has(command)));
  const found = new Map();
  if (!selected.size) return found;
  const explicit = env.SEAL_TOOL_INSTALL_MANIFEST !== undefined;
  const filename = explicit ? env.SEAL_TOOL_INSTALL_MANIFEST : path.join(userHome, '.local', 'share', 'seal-tools', 'native', 'installations.json');
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || filename.includes('\0')) {
    throw new Error('SEAL_TOOL_INSTALL_MANIFEST must be a nonempty absolute file path.');
  }
  let fd;
  try {
    const info = fs.lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MANIFEST_LIMIT) throw new Error('expected a bounded regular manifest, not a symlink');
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size > MANIFEST_LIMIT) throw new Error('manifest changed while opening');
    const bytes = Buffer.alloc(MANIFEST_LIMIT + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MANIFEST_LIMIT) throw new Error('manifest exceeds its size limit');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    if (value?.schemaVersion !== 1 || value.mode !== 'user-prefix-extracted-deb' || !Array.isArray(value.installations) || value.installations.length > 64) {
      throw new Error('unsupported installation manifest schema');
    }
    const root = fs.realpathSync(path.dirname(filename));
    for (const entry of value.installations) {
      if (!entry || !selected.has(entry.name)) continue;
      if (found.has(entry.name)) throw new Error(`duplicate installation for ${entry.name}`);
      if (typeof entry.prefix !== 'string' || !path.isAbsolute(entry.prefix) || entry.prefix.includes('\0')
        || typeof entry.packageVersion !== 'string' || !/^[A-Za-z0-9.+:~_-]{1,128}$/.test(entry.packageVersion)
        || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) throw new Error(`invalid installation metadata for ${entry.name}`);
      const prefix = path.normalize(entry.prefix);
      const expected = path.join(prefix, 'usr', 'bin', entry.name);
      if (!inside(root, prefix) || entry.executable !== expected) throw new Error(`installation for ${entry.name} leaves its private prefix`);
      let problem = null;
      try {
        const executableInfo = fs.lstatSync(expected);
        if (!executableInfo.isFile() || executableInfo.isSymbolicLink() || fs.realpathSync(expected) !== expected
          || fs.realpathSync(prefix) !== prefix) throw new Error(`redirected or nonregular executable for ${entry.name}`);
        fs.accessSync(expected, fs.constants.X_OK);
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error;
        problem = `Registered private tool is missing or inaccessible: ${expected}. No PATH replacement was selected.`;
      }
      found.set(entry.name, {
        executable: problem ? null : expected,
        problem,
        manifestPath: filename,
        prefix,
        packageVersion: entry.packageVersion,
        packageSha256: entry.sha256,
        note: 'The digest identifies the distribution package recorded at installation, not the current executable contents. Runtime readiness is checked separately.',
      });
    }
    return found;
  } catch (error) {
    if (!explicit && error.code === 'ENOENT' && fd === undefined) return found;
    throw new Error(`Cannot read private tool installation metadata ${filename}: ${error.message}`, { cause: error });
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function withPreparedToolPath(env, userHome) {
  const installed = privateToolInstallations({ commands: ['xxd', 'pngcheck', 'upx-ucl', 'rsvg-convert', 'stegseek'], env, userHome });
  if (!installed.size) return env;
  const currentPath = env.PATH ?? '';
  const alreadyPresent = new Set(currentPath.split(path.delimiter));
  const directories = [];
  for (const name of ['xxd', 'pngcheck', 'upx-ucl', 'rsvg-convert', 'stegseek']) {
    const executable = installed.get(name)?.executable;
    if (!executable) continue;
    const directory = path.dirname(executable);
    if (!alreadyPresent.has(directory)) {
      alreadyPresent.add(directory);
      directories.push(directory);
    }
  }
  return directories.length ? { ...env, PATH: [...directories, currentPath].filter(Boolean).join(path.delimiter) } : env;
}
