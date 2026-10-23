import { mkdir, lstat, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getToolCatalog } from "./tool-catalog.mjs";
import { readCapturedText, runBounded } from "./tool-process.mjs";
import { findProblemRoot } from "./problems.mjs";

const ARCHIVE_INDEX_SCRIPT = fileURLToPath(new URL("./archive-index.py", import.meta.url));
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const ARCHIVE_COUNT_FIELDS = Object.freeze({
  file: "fileCount", directory: "directoryCount", symlink: "linkCount", special: "specialCount",
});
const ARCHIVE_COUNTERS = Object.freeze(Object.values(ARCHIVE_COUNT_FIELDS));

const OBSERVATIONS = {
  "file-identify": {
    args: ["--brief", "--mime", "--no-dereference"],
    timeoutMs: 5000,
    note: "File magic and encoding only; no decompression or execution.",
  },
  "elf-header": {
    args: ["--file-header", "--wide"],
    timeoutMs: 5000,
    note: "ELF header metadata only; the input program is never executed.",
  },
  "pcap-summary": {
    args: ["-M", "-t", "-E", "-c", "-s", "-u", "-a", "-e", "-S", "-K", "-P"],
    timeoutMs: 15000,
    note: "Local capture metadata; may scan the full file. No live capture or packet payload output.",
  },
  "hex-preview": {
    args: ["-p", "-l", "256"], separator: false,
    timeoutMs: 5000,
    note: "Only the first 256 bytes are observed; decoded bytes are not executed.",
  },
  "png-check": {
    args: ["-q"], separator: false, negativeExit: 2,
    timeoutMs: 15000,
    note: "Container validation only. A rejected validator result is not a tool-launch error; diagnostics remain separate.",
  },
  "archive-index": {
    args: ["-I", "-B", ARCHIVE_INDEX_SCRIPT], separator: false, negativeExit: 2,
    timeoutMs: 15000,
    note: "ZIP/TAR metadata only; no extraction, decryption, member execution or external connection. At most 512 entries are returned.",
  },
};

function observation(id) {
  if (!Object.hasOwn(OBSERVATIONS, id)) {
    throw new Error(`Inspect supports ${Object.keys(OBSERVATIONS).join(", ")} only; no arbitrary command is accepted.`);
  }
  return OBSERVATIONS[id];
}

export function observationHelp(id) {
  if (id === undefined) {
    return `Usage: seal tools inspect ID INPUT [--timeout-ms N]\nSupported: ${Object.keys(OBSERVATIONS).join(", ")}\nUse seal tools inspect ID --help for focused input, timeout and output guidance.\n`;
  }
  const operation = observation(id);
  const projection = id === "archive-index"
    ? "{status, reportPath, complete: .facts.complete, totalEntries: .facts.totalEntries, totals: .facts.totals}"
    : "{status, reportPath, facts, executionStatus: .execution.status, inputChanged: .input.changed}";
  return [
    `Usage: seal tools inspect ${id} INPUT [--timeout-ms N]`,
    "Input: regular local file within the current workspace/problem. No target execution.",
    `Default wall-time: ${operation.timeoutMs}ms. Override: integer milliseconds, 1..120000.`,
    "Output: JSON on stdout; full receipt at reportPath. No --json flag is required.",
    "timeout is not corrupt input; rejected/invalid_input are not valid empty results.",
    operation.note,
    ...(id === "archive-index" ? ["Non-null totals cover all members; null means unknown. complete describes the bounded member list, not the totals."] : []),
    "For concise output, project fields on the first call. Insert timeout options before the pipe:",
    "set -o pipefail",
    `seal tools inspect ${id} INPUT | jq '${projection}'`,
    "",
  ].join("\n");
}

function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function identity(info) {
  return {
    device: String(info.dev), inode: String(info.ino), sizeBytes: String(info.size),
    modifiedNs: String(info.mtimeNs), changedNs: String(info.ctimeNs),
  };
}

async function privateDirectory(directory) {
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory) {
    throw new Error(`Observation storage must be a real directory: ${directory}`);
  }
}

function fields(text) {
  const result = new Map();
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) result.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return result;
}

export function parseObservation(id, output, context = {}) {
  if (id === "file-identify") {
    const match = /^([\w!#$&^.+-]+\/[\w!#$&^.+-]+);\s*charset=([\w.+-]+)\s*$/.exec(output);
    if (!match) throw new Error("Unexpected file MIME output; inspect the preserved stdout instead of guessing the type.");
    return { mimeType: match[1], encoding: match[2] };
  }
  if (id === "hex-preview") {
    const hex = output.replace(/\s/g, "");
    if (!/^(?:[a-fA-F0-9]{2}){0,256}$/.test(hex)) throw new Error("Unexpected hexadecimal prefix output.");
    const bytesRead = hex.length / 2;
    if (context.inputSize !== undefined && bytesRead !== Number(BigInt(context.inputSize) < 256n ? BigInt(context.inputSize) : 256n)) {
      throw new Error("Hex output does not match the requested bounded input prefix.");
    }
    return { offset: 0, bytesRead, hex: hex.toLowerCase(), scope: "first-up-to-256-bytes",
      completeInput: context.inputSize === undefined ? null : BigInt(context.inputSize) <= BigInt(bytesRead) };
  }
  if (id === "png-check") {
    if (![0, 2].includes(context.exitCode)) throw new Error("Unexpected pngcheck completion code.");
    return { validator: "pngcheck", accepted: context.exitCode === 0 };
  }
  if (id === "archive-index") {
    const value = JSON.parse(output);
    const decimal = number => typeof number === "string" && /^\d{1,40}$/.test(number);
    const validEntry = entry => entry && typeof entry.name === "string" && entry.name.length <= 4096
      && typeof entry.nameTruncated === "boolean" && decimal(entry.sizeBytes)
      && (entry.compressedBytes === null || decimal(entry.compressedBytes))
      && typeof entry.kind === "string" && Object.hasOwn(ARCHIVE_COUNT_FIELDS, entry.kind)
      && typeof entry.encrypted === "boolean" && typeof entry.unsafeExtractionPath === "boolean";
    if (!value || !["zip", "tar"].includes(value.format) || !Array.isArray(value.entries) || value.entries.length > 512
      || !value.entries.every(validEntry) || typeof value.complete !== "boolean"
      || !(value.totalEntries === null || Number.isSafeInteger(value.totalEntries) && value.totalEntries >= value.entries.length)
      || value.complete && (value.totalEntries !== value.entries.length || value.entries.some(entry => entry.nameTruncated))) {
      throw new Error("Unexpected archive inventory schema; no partial text was promoted to member facts.");
    }
    const totals = value.totals;
    if (value.totalEntries === null) {
      if (totals !== null) throw new Error("Unknown archive extent cannot have whole-archive totals.");
    } else {
      if (!totals || !decimal(totals.uncompressedFileBytes)
        || !ARCHIVE_COUNTERS.every(key => Number.isSafeInteger(totals[key]) && totals[key] >= 0)
        || ARCHIVE_COUNTERS.reduce((sum, key) => sum + totals[key], 0) !== value.totalEntries) {
        throw new Error("Invalid whole-archive counts or declared byte total.");
      }
      const listed = { fileCount: 0, directoryCount: 0, linkCount: 0, specialCount: 0 };
      let listedBytes = 0n;
      for (const entry of value.entries) {
        listed[ARCHIVE_COUNT_FIELDS[entry.kind]]++;
        if (entry.kind === "file") listedBytes += BigInt(entry.sizeBytes);
      }
      const allMembersListed = value.totalEntries === value.entries.length;
      const totalBytes = BigInt(totals.uncompressedFileBytes);
      if (ARCHIVE_COUNTERS.some(key => totals[key] < listed[key] || allMembersListed && totals[key] !== listed[key])
        || totalBytes < listedBytes || allMembersListed && totalBytes !== listedBytes) {
        throw new Error("Archive totals contradict the listed member metadata.");
      }
    }
    return value;
  }
  const values = fields(output);
  if (id === "elf-header") {
    if (!/^ELF(?:32|64)$/.test(values.get("Class") ?? "") || !values.has("Machine") || !values.has("Type")) {
      throw new Error("Expected an ELF header; no architecture or program behavior was inferred from this output.");
    }
    return {
      format: "ELF", class: values.get("Class"), dataEncoding: values.get("Data") ?? null,
      osAbi: values.get("OS/ABI") ?? null, type: values.get("Type"), machine: values.get("Machine"),
      entryPoint: values.get("Entry point address") ?? null,
    };
  }
  if (id === "pcap-summary") {
    const rawCount = values.get("Number of packets") ?? "";
    const packetCount = /^\d+$/.test(rawCount) ? Number(rawCount) : NaN;
    if (!Number.isSafeInteger(packetCount) || !values.has("File type")) {
      throw new Error("Unexpected capture-summary format; inspect preserved output before interpreting packet counts.");
    }
    const earliest = values.get("Earliest packet time");
    const latest = values.get("Latest packet time");
    const validTime = value => value === "n/a" || /^-?\d+(?:\.\d+)?$/.test(value ?? "");
    if (!validTime(earliest) || !validTime(latest)) {
      throw new Error("Unexpected capture timestamp fields; no time bounds were inferred from missing or incompatible output.");
    }
    return {
      captureType: values.get("File type"), encapsulation: values.get("File encapsulation") ?? null,
      packetCount, reportedFileSize: values.get("File size") ?? null,
      duration: values.get("Capture duration") ?? null,
      earliestPacketTime: earliest === "n/a" ? null : earliest,
      latestPacketTime: latest === "n/a" ? null : latest,
      timestampUnits: "epoch seconds preserved as strings; unavailable times are null",
    };
  }
  throw new Error(`Unknown observation capability: ${id}`);
}

export async function inspectLocal({ workspace, id, input, env = process.env, timeoutMs, signal }) {
  const operation = observation(id);
  if (typeof workspace !== "string" || !path.isAbsolute(workspace)) throw new Error("Inspection workspace must be an absolute path.");
  if (typeof input !== "string" || !input || input.includes("\0") || /^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    throw new Error("Inspect requires a regular local input file, not a URL or remote target.");
  }
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)) {
    throw new Error("--timeout-ms must be an integer from 1 to 120000.");
  }
  const workspaceRoot = await realpath(workspace);
  const currentProblem = await findProblemRoot(workspaceRoot);
  const boundary = currentProblem ?? workspaceRoot;
  const filename = await realpath(path.resolve(workspaceRoot, input));
  if (!inside(boundary, filename)) throw new Error("Input resolves outside the current CTF workspace or problem folder.");
  const before = await stat(filename, { bigint: true });
  if (!before.isFile()) throw new Error("Inspect accepts regular files only; directories, devices and FIFOs are not inputs.");

  const catalog = await getToolCatalog({ ids: [id], env });
  const capability = catalog.capabilities.find(item => item.id === id);
  if (!capability?.executable || capability.availability !== "available") {
    return {
      schemaVersion: 1, capability: id, status: "unavailable", facts: null,
      input: { path: filename, identity: identity(before), identityKind: "filesystem-stat", contentHash: null },
      error: `The ${id} executable is unavailable; inspect seal tools list and prepare it explicitly.`,
      modelInference: false, externalAction: false,
    };
  }

  const inputProblem = await findProblemRoot(path.dirname(filename));
  const artifactRoot = inputProblem && inside(boundary, inputProblem) ? inputProblem : boundary;
  const sealDir = path.join(artifactRoot, ".seal");
  await privateDirectory(sealDir);
  const base = path.join(sealDir, "observations");
  await privateDirectory(base);
  const artifactDir = path.join(base, randomUUID());
  await mkdir(artifactDir, { mode: 0o700 });
  const execution = await runBounded({
    executable: capability.executable, args: [...operation.args, ...(operation.separator === false ? [] : ["--"]), filename],
    cwd: artifactRoot, env: { ...env, LC_ALL: "C", LANG: "C", TZ: "UTC", NO_COLOR: "1", PYTHONDONTWRITEBYTECODE: "1" },
    artifactDir, timeoutMs: timeoutMs ?? operation.timeoutMs,
    maxOutputBytes: OUTPUT_LIMIT, previewBytes: 8192, signal,
  });
  let after = null;
  try { after = identity(await stat(filename, { bigint: true })); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const beforeIdentity = identity(before);
  const changed = after === null || Object.keys(beforeIdentity).some(key => beforeIdentity[key] !== after[key]);
  let status = changed ? "input_changed" : execution.status;
  let facts = null;
  let interpretationError = null;
  const expectedNegative = execution.status === "failed" && execution.signal === null && execution.exitCode === operation.negativeExit;
  if (!changed && (execution.status === "completed" || expectedNegative)) {
    try {
      const output = readCapturedText(execution.stdout, OUTPUT_LIMIT);
      if (id === "archive-index" && expectedNegative) {
        const error = JSON.parse(output);
        if (typeof error?.error !== "string" || error.error.length > 2048 || typeof error.kind !== "string") throw new Error("Archive helper returned an invalid error record.");
        status = "invalid_input";
        interpretationError = `${error.kind}: ${error.error}`;
      } else {
        facts = parseObservation(id, output, { exitCode: execution.exitCode, inputSize: before.size.toString() });
        status = id === "png-check" && !facts.accepted ? "rejected"
          : id === "archive-index" && !facts.complete ? "partial" : "completed";
      }
    } catch (error) {
      status = execution.status === "completed" ? "unparsed" : execution.status;
      interpretationError = error.message;
    }
  }
  const report = {
    schemaVersion: 1, capability: id, status, observedAt: new Date().toISOString(),
    workspaceRoot, artifactRoot,
    input: { path: filename, identity: beforeIdentity, afterIdentity: after, changed, identityKind: "filesystem-stat", contentHash: null },
    tool: { executable: capability.executable, identity: capability.identity, lastReadiness: capability.readiness },
    facts, interpretationError, execution,
    limits: { timeoutMs: timeoutMs ?? operation.timeoutMs, combinedOutputBytes: OUTPUT_LIMIT, parseBytes: OUTPUT_LIMIT, previewBytes: 8192 },
    limitations: [operation.note, "Filesystem metadata is not a content digest. Results are not automatically cached or reused.", "Time/output limits are enforced; no RAM/CPU isolation or analysis-success guarantee is claimed."],
    modelInference: false, externalAction: false,
    reportPath: path.join(artifactDir, "result.json"),
  };
  await writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return report;
}
