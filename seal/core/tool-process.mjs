import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';

const PIPE_DRAIN_MS = 100;
const TERM_GRACE_MS = 150;
const KILL_DRAIN_MS = 150;
const MAX_TIMER_MS = 2 ** 31 - 1;

function absolutePath(value, name) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new TypeError(`${name} must be an absolute path without NUL bytes`);
  }
}

function limit(value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
}

export function readCapturedText(capture, maximumBytes) {
  if (!capture?.retainedComplete) throw new Error('Captured output is incomplete; preserved bytes are not a complete result.');
  absolutePath(capture.path, 'capture.path');
  limit(maximumBytes, 'maximumBytes', 0);
  limit(capture.bytes, 'capture.bytes', 0, maximumBytes);
  const fd = fs.openSync(capture.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size !== capture.bytes) throw new Error('Captured output changed or is not a regular file.');
    const bytes = Buffer.alloc(capture.bytes);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error('Captured output ended before its recorded size.');
      offset += count;
    }
    if (fs.fstatSync(fd).size !== capture.bytes) throw new Error('Captured output changed while reading.');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    fs.closeSync(fd);
  }
}

// Internal building block only: callers select fixed, benign executable/argument pairs.
// The caller owns artifactDir; this helper never removes or replaces its contents.
export async function runBounded({
  executable,
  args = [],
  cwd,
  env = process.env,
  artifactDir,
  timeoutMs = 10000,
  maxOutputBytes = 2 * 1024 * 1024,
  previewBytes = 8192,
  signal,
}) {
  absolutePath(executable, 'executable');
  absolutePath(cwd, 'cwd');
  absolutePath(artifactDir, 'artifactDir');
  limit(timeoutMs, 'timeoutMs', 1, MAX_TIMER_MS);
  limit(maxOutputBytes, 'maxOutputBytes', 1);
  limit(previewBytes, 'previewBytes', 0);
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new TypeError('args must be an array of strings without NUL bytes');
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError('signal must be an AbortSignal');
  }

  const started = performance.now();
  const captures = ['stdout', 'stderr'].map((name) => ({
    name,
    path: path.join(artifactDir, `${name}.bin`),
    fd: null,
    bytes: 0,
    previewChunks: [],
    previewLength: 0,
    truncated: false,
    ended: false,
  }));
  let totalBytes = 0;
  let status = null;
  let error = null;
  let exitCode = null;
  let exitSignal = null;

  function recordError(message) {
    // Error reporting itself remains bounded if both streams repeatedly fail.
    if (error === null) error = message;
  }

  function result() {
    const streams = captures.map((capture) => {
      if (capture.fd !== null) {
        try {
          fs.closeSync(capture.fd);
        } catch (cause) {
          capture.truncated = true;
          recordError(`Cannot close ${capture.name} artifact: ${cause.message}`);
          status ??= 'failed';
        }
        capture.fd = null;
      }
      const retainedComplete = capture.ended && !capture.truncated;
      const decoder = new StringDecoder('utf8');
      const prefix = Buffer.concat(capture.previewChunks, capture.previewLength);
      let preview = decoder.write(prefix);
      // A preview boundary must not invent a replacement character for a split code point.
      const truncated = capture.truncated || capture.bytes > capture.previewLength;
      if (!truncated) preview += decoder.end();
      // Malformed UTF-8 can expand when decoded. Bound the displayed UTF-8 bytes too.
      if (Buffer.byteLength(preview, 'utf8') > previewBytes) {
        const boundedDecoder = new StringDecoder('utf8');
        preview = boundedDecoder.write(Buffer.from(preview, 'utf8').subarray(0, previewBytes));
        capture.truncated = true;
      }
      capture.previewChunks = [];
      return {
        path: capture.path,
        bytes: capture.bytes,
        preview,
        truncated: truncated || capture.truncated,
        retainedComplete,
      };
    });
    return {
      status: status ?? (exitCode === 0 && exitSignal === null ? 'completed' : 'failed'),
      exitCode,
      signal: exitSignal,
      elapsedMs: Math.max(0, performance.now() - started),
      stdout: streams[0],
      stderr: streams[1],
      error,
    };
  }

  try {
    for (const capture of captures) {
      capture.fd = fs.openSync(capture.path, 'wx', 0o600);
      fs.fchmodSync(capture.fd, 0o600);
    }
  } catch (cause) {
    status = 'failed';
    recordError(`Cannot create private capture artifacts: ${cause.message}`);
    for (const capture of captures) capture.truncated = true;
    return result();
  }
  if (signal?.aborted) {
    status = 'cancelled';
    return result();
  }

  return new Promise((resolve) => {
    let child;
    let finished = false;
    let closed = false;
    let stopping = false;
    let killSent = false;
    const timers = new Set();
    const streamListeners = [];

    function later(callback, delay) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
    }

    function finish() {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      signal?.removeEventListener('abort', onAbort);
      for (const { stream, onData, onEnd, onError, capture } of streamListeners) {
        if (!capture.ended) capture.truncated = true;
        stream.destroy();
        stream.removeListener('data', onData);
        stream.removeListener('end', onEnd);
        stream.removeListener('error', onError);
      }
      if (child) {
        child.removeListener('error', onChildError);
        child.removeListener('exit', onExit);
        child.removeListener('close', onClose);
        // Even a kernel-stalled child cannot keep the caller's event loop alive forever.
        if (!closed) child.unref();
      }
      resolve(result());
    }

    function killOwned(killSignal) {
      if (!child?.pid) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, killSignal);
        else if (child.exitCode === null && child.signalCode === null) child.kill(killSignal);
      } catch (cause) {
        if (cause.code !== 'ESRCH') recordError(`Cannot send ${killSignal} to owned process: ${cause.message}`);
      }
    }

    function stop(reason, message) {
      if (finished) return;
      status ??= reason;
      if (message) recordError(message);
      if (stopping) return;
      stopping = true;
      killOwned('SIGTERM');
      // Do not finish merely because the leader closed: its descendants may ignore TERM.
      later(() => {
        killSent = true;
        killOwned('SIGKILL');
        if (closed) finish();
        else later(finish, KILL_DRAIN_MS);
      }, TERM_GRACE_MS);
    }

    function onAbort() {
      stop('cancelled');
    }

    function onChildError(cause) {
      if (child?.pid) stop('failed', `Owned process error: ${cause.message}`);
      else {
        status ??= 'spawn_error';
        recordError(`Cannot spawn executable: ${cause.message}`);
        finish();
      }
    }

    function onExit(code, receivedSignal) {
      exitCode = code;
      exitSignal = receivedSignal;
      if (!stopping) {
        // 'exit' is not 'close': descendants can inherit pipes after the leader exits.
        later(() => {
          if (!closed) stop('failed', 'Output pipes remained open after the owned process exited');
        }, PIPE_DRAIN_MS);
      }
    }

    function onClose(code, receivedSignal) {
      closed = true;
      exitCode = code;
      exitSignal = receivedSignal;
      if (!stopping || killSent) finish();
    }

    function captureData(capture, chunk) {
      if (finished) return;
      const allowed = Math.min(chunk.length, maxOutputBytes - totalBytes);
      let offset = 0;
      try {
        // Synchronous bounded writes avoid an unbounded pending filesystem-write queue.
        while (offset < allowed) {
          const written = fs.writeSync(capture.fd, chunk, offset, allowed - offset);
          if (written === 0) throw new Error('capture write made no progress');
          const previewLength = Math.min(written, previewBytes - capture.previewLength);
          if (previewLength > 0) {
            capture.previewChunks.push(Buffer.from(chunk.subarray(offset, offset + previewLength)));
            capture.previewLength += previewLength;
          }
          offset += written;
          capture.bytes += written;
          totalBytes += written;
        }
      } catch (cause) {
        capture.truncated = true;
        stop('failed', `Cannot capture ${capture.name}: ${cause.message}`);
        return;
      }
      // Exactly-cap-sized complete output is not truncation; one additional byte is.
      if (allowed < chunk.length) {
        capture.truncated = true;
        stop('output_limit');
      }
    }

    try {
      child = spawn(executable, args, {
        cwd,
        env,
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (cause) {
      status = 'spawn_error';
      recordError(`Cannot spawn executable: ${cause.message}`);
      finish();
      return;
    }
    child.on('error', onChildError);
    child.once('exit', onExit);
    child.once('close', onClose);
    for (let index = 0; index < captures.length; index += 1) {
      const capture = captures[index];
      const stream = index === 0 ? child.stdout : child.stderr;
      const onData = (chunk) => captureData(capture, chunk);
      const onEnd = () => { capture.ended = true; };
      const onError = (cause) => {
        capture.truncated = true;
        stop('failed', `Cannot read ${capture.name} pipe: ${cause.message}`);
      };
      streamListeners.push({ stream, onData, onEnd, onError, capture });
      stream.on('data', onData);
      stream.once('end', onEnd);
      stream.on('error', onError);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    later(() => stop('timeout'), Math.max(1, timeoutMs - (performance.now() - started)));
  });
}
