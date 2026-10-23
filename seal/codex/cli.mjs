import { spawn } from "node:child_process";
import { constants, homedir } from "node:os";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { ensureCodexHome, getCodexHome, isolationOverrides, nativeEnvironment } from "./config.mjs";
import { DEFAULT_MODEL, LIGHTWEIGHT_MODEL, MODEL_CONTEXT_LIMITS, modelContextLimits } from "../core/model-policy.mjs";
import { ensureOwnedSkills } from "./owned-skills.mjs";
import { OWNED_SKILL_NAMES } from "../core/skill-names.mjs";
import { workspaceContext } from "../core/instructions.mjs";
import { getToolCatalog, checkToolCatalog } from "../core/tool-catalog.mjs";
import { inspectLocal, observationHelp } from "../core/observations.mjs";
import { withPreparedToolPath } from "../core/native-tools.mjs";
import { appendProblemNote, findProblemRoot, initProblem, listProblems } from "../core/problems.mjs";

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const COMMANDS = new Set(["exec", "resume", "setup", "config", "login", "tools", "problem", "update", "daemon"]);
const REMOVED_SESSION_COMMANDS = new Set(["status", "record"]);
const HELP = `seal — shared-folder native Codex CTF profile

From the current CTF workspace:
  seal [prompt]                         Open the configured main model (Sol by default)
  seal --model gpt-6-luna --effort low  Explicit lightweight task in the current folder
  seal --yolo [prompt]                  Explicit native YOLO mode
  seal exec <prompt>                    One noninteractive task in the current folder
  seal resume                          Open the native CTF conversation picker
  seal resume --last                   Continue the latest conversation in this folder
  seal resume --all                    Show conversations from all folders
  seal resume SESSION_ID [PROMPT]      Resume a native conversation UUID or name

Shared problem organization:
  seal problem init "Problem Name"      Create/reuse the named problem folder
  seal problem init "Name" --category web
  seal problem list [--json]            List initialized problem folders
  seal problem note [NAME] --message X  Atomically append a shared update

Each problem folder contains:
  .seal/problem.json, challenge.md, attachments/, solve/, artifacts/, NOTES.md
  writeup.md is created only after a solved problem when requested.

Setup and native maintenance:
  seal setup                             Prepare the isolated configuration
  seal config                            Show requested profile settings
  seal login [status]                    Native browser OAuth / login status
  seal --version                         Show the selected native Codex version
  seal update                            Run its latest-release CLI updater
  seal daemon version                    Show CLI/CTF-daemon version information
  seal daemon update                     Native latest daemon update; confirmation retained

Prepared local tools (no model inference or automatic installation):
  seal tools list [ID...] [--json] [--brief]
  seal tools check [ID...] [--no-save]
  seal tools inspect ID INPUT [--timeout-ms N]
  Structured inspect IDs: file-identify, elf-header, pcap-summary, hex-preview, png-check, archive-index

Options:
  --effort LEVEL      low, medium, high, xhigh, max
  --model, -m MODEL   Explicit gpt-6-sol or gpt-6-luna selection
  --fast              Request the native priority (Fast) service tier for this launch
  --offline-tools     Disable network for sandboxed shell tools in this launch
  --yolo              Explicitly disable native approvals and sandbox
  --no-daemon         Explicit embedded mode for interactive launch/resume
  --version, -V      Show the native executable version without starting a model
  --category TEXT     Category recorded by problem init
  --message TEXT      Shared update for problem note
  --json              Machine-readable command output; native JSONL for exec
  --brief             Compact tool-list metadata; no probes or extra model calls
  --last              Resume the latest native conversation
  --all               Disable cwd filtering in the native resume picker
  --include-non-interactive  Include exec conversations in native resume selection
  --no-save           Do not persist a tools check result
  --timeout-ms N      Inspection wall time (1..120000)
  --help              Show this help

The folder where seal starts is the shared filesystem workspace. SEAL does not
create per-agent run/work/event folders, lock a problem to one agent, assign
problems, or auto-submit flags. When the user directly authorizes an exact flag
submission, the Codex agent is instructed to submit and verify it through the authorized browser.
Resume uses the isolated CODEX_HOME history and the current launch folder.
Without --model or --effort, native configuration/resume chooses model and effort.
Daybreak is requested; unsupported models/accounts fail rather than silently
falling back to standard access. Fast is opt-in unless already selected in config.
The native executable is resolved on every launch; no Codex version is bundled
or pinned. Native update checks and daemon compatibility remain native behavior.
`;

function displayText(value) {
  return String(value).replace(/[\p{Cc}\p{Cf}]/gu, "?");
}

export function parseArguments(argv) {
  const parsed = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "V" },
      "no-daemon": { type: "boolean" },
      model: { type: "string", short: "m" },
      fast: { type: "boolean" },
      "offline-tools": { type: "boolean" },
      yolo: { type: "boolean" },
      json: { type: "boolean" },
      brief: { type: "boolean" },
      effort: { type: "string" },
      last: { type: "boolean" },
      all: { type: "boolean" },
      "include-non-interactive": { type: "boolean" },
      category: { type: "string" },
      message: { type: "string" },
      "no-save": { type: "boolean" },
      "timeout-ms": { type: "string" },
    },
  });
  const positionals = [...parsed.positionals];
  const first = positionals[0];
  const command = COMMANDS.has(first) || REMOVED_SESSION_COMMANDS.has(first) ? positionals.shift() : "new";
  const options = parsed.values;
  if (options.help) return { command, options, positionals };
  if (options.version || command === "update" || command === "daemon") {
    if (Object.keys(options).some(key => key !== "version") || options.version && command !== "new") {
      throw new Error("Native maintenance commands do not accept solver, tool, or profile options.");
    }
    if (options.version && positionals.length || command === "update" && positionals.length) {
      throw new Error("Use seal --version or seal update without a prompt or version pin.");
    }
    if (command === "daemon" && (positionals.length !== 1 || !["version", "update"].includes(positionals[0]))) {
      throw new Error("Use seal daemon version or seal daemon update. Restart/stop and unattended confirmation are not implicit.");
    }
    return { command: options.version ? "version" : command, options, positionals };
  }
  if (REMOVED_SESSION_COMMANDS.has(command)) {
    throw new Error(`${command} was removed with SEAL session workspaces. Start another seal agent in the same folder; shared state belongs in the problem folder.`);
  }
  if (options.effort !== undefined && !EFFORTS.has(options.effort)) {
    throw new Error(`Unsupported effort ${JSON.stringify(options.effort)}; choose ${[...EFFORTS].join(", ")}.`);
  }
  if (options.model !== undefined) modelContextLimits(options.model);
  if ((options.model !== undefined || options.fast || options["offline-tools"] || options.effort !== undefined) && !["new", "exec", "resume"].includes(command)) {
    throw new Error("--model, --fast, --offline-tools, and --effort apply only to native Codex launches.");
  }
  if (options.yolo && !["new", "exec", "resume"].includes(command)) {
    throw new Error("--yolo applies only to native Codex launches: seal, seal exec, or seal resume.");
  }
  if (options["offline-tools"] && options.yolo) {
    throw new Error("--offline-tools cannot be combined with --yolo, which disables the native sandbox.");
  }
  if (options["no-daemon"] && !["new", "resume"].includes(command)) {
    throw new Error("--no-daemon applies only to interactive seal or seal resume.");
  }
  if (command !== "resume" && (options.last || options.all || options["include-non-interactive"])) {
    throw new Error("--last, --all, and --include-non-interactive apply only to seal resume.");
  }
  if (options.brief && command !== "tools") throw new Error("--brief applies only to seal tools list.");
  if (command === "resume") {
    if (options.json) throw new Error("seal resume opens the native interactive UI and does not accept --json.");
    if (positionals.length > 2) throw new Error('Use seal resume [SESSION_ID] ["follow-up prompt"]; quote a prompt containing spaces.');
  }
  if (command === "tools") {
    if (options.yolo || options.category || options.message) {
      throw new Error("tools accepts capability options, not solver, category, or note options.");
    }
    return { command, options, positionals };
  }
  if (command === "problem") {
    if (options.yolo || options["no-save"] || options["timeout-ms"] !== undefined) {
      throw new Error("problem accepts --category, --message, and --json, not solver or tool-check options.");
    }
    return { command, options, positionals };
  }
  if (options.category || options.message) throw new Error("--category and --message are problem-command options.");
  if (options["no-save"] || options["timeout-ms"] !== undefined) throw new Error("--no-save and --timeout-ms are tool-command options.");
  if (["setup", "config"].includes(command) && positionals.length) throw new Error(`${command} does not accept a prompt.`);
  if (command === "login" && (positionals.length > 1 || (positionals.length && positionals[0] !== "status"))) {
    throw new Error("Use login for native browser OAuth, or login status. No credentials are accepted by this launcher.");
  }
  if (command === "exec" && !positionals.length) throw new Error("exec requires a prompt.");
  return { command, options, positionals };
}

function overrideArgs(values) {
  return values.flatMap(value => ["-c", value]);
}

function nativeArguments(overrides, workspaceRoot, options, command, positionals) {
  const common = ["--strict-config", ...overrideArgs(overrides)];
  const permissions = options.yolo ? ["--yolo"] : [];
  const daemon = options["no-daemon"] ? ["--no-daemon"] : [];
  const requested = [
    "agents.enabled=false",
    "tui.terminal_title=[]",
    "daybreak=true",
    "features.cli_daybreak=true",
    `developer_instructions=${JSON.stringify(workspaceContext(workspaceRoot))}`,
  ];
  if (options.model !== undefined) {
    const model = options.model;
    const context = modelContextLimits(model);
    requested.push(
      `model=${JSON.stringify(model)}`,
      `model_context_window=${context.contextWindow}`,
      `model_auto_compact_token_limit=${context.autoCompactTokenLimit}`,
      'model_auto_compact_token_limit_scope="total"',
    );
  }
  if (options.effort !== undefined) requested.push(`model_reasoning_effort=${JSON.stringify(options.effort)}`);
  if (options.fast) requested.push('service_tier="priority"');
  if (options["offline-tools"]) requested.push("sandbox_workspace_write.network_access=false");
  if (command === "resume") {
    const args = [...common, ...daemon, "resume", ...permissions, ...overrideArgs(requested), "--cd", workspaceRoot];
    for (const flag of ["last", "all", "include-non-interactive"]) {
      if (options[flag]) args.push(`--${flag}`);
    }
    if (positionals.length) args.push("--", ...positionals);
    return args;
  }
  const prompt = positionals.join(" ");
  if (command === "exec") {
    const args = [...common, "exec", "--cyber-access-program", "daybreak_blue", ...overrideArgs(requested), ...permissions, "--skip-git-repo-check", "--json"];
    if (prompt) args.push("--", prompt);
    return args;
  }
  const args = [...common, ...daemon, ...permissions, ...overrideArgs(requested)];
  if (prompt) args.push("--", prompt);
  return args;
}

async function runNative({ executable, args, env, cwd, stderr }) {
  const child = spawn(executable, args, { cwd, env, stdio: "inherit", shell: false });
  const ending = new Promise(resolve => {
    child.once("error", error => resolve({ error }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  try {
    await once(child, "spawn");
    const result = await ending;
    if (result.error) throw result.error;
    return result.code ?? (128 + (constants.signals[result.signal] ?? 1));
  } catch (error) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await ending;
    }
    const message = error.code === "ENOENT"
      ? `Native Codex executable not found: ${displayText(executable)}. Install/configure native Codex; no alternative executable was selected.`
      : `Native Codex could not run: ${error.message}`;
    stderr.write(`${displayText(message)}\n`);
    return error.code === "ENOENT" ? 127 : 1;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

async function withCancellation(operation) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, cancel);
  try { return await operation(controller.signal); }
  finally { for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.off(signal, cancel); }
}

async function toolCommand(options, positionals, { cwd, env, stdout }) {
  const [action = "list", ...args] = positionals;
  if (options.brief && action !== "list") throw new Error("--brief applies only to seal tools list.");
  if (action === "list") {
    if (options["no-save"] || options["timeout-ms"] !== undefined) throw new Error("Use seal tools list [ID...] [--json].");
    const catalog = await getToolCatalog({ ids: args, env });
    const view = options.brief ? {
      schemaVersion: catalog.schemaVersion,
      capabilities: catalog.capabilities.map(item => ({
        id: item.id, purpose: item.purpose, executable: item.executable,
        availability: item.availability,
        readiness: { state: item.readiness.state, checkedAt: item.readiness.checkedAt },
        input: item.selection?.input ?? null, cost: item.selection?.cost ?? "see focused card",
      })),
    } : catalog;
    if (options.json) stdout.write(`${JSON.stringify(view, null, 2)}\n`);
    else {
      for (const item of catalog.capabilities) stdout.write(`${item.id}  ${item.availability}/${item.readiness.state}  ${displayText(item.purpose)}\n`);
      stdout.write(`Readiness cache: ${displayText(catalog.cachePath)}\nAvailability is not analysis success.\n`);
    }
    return 0;
  }
  if (action === "check") {
    if (options["timeout-ms"] !== undefined) throw new Error("Readiness checks use fixed probes, not problem inputs.");
    const report = await withCancellation(signal => checkToolCatalog({ ids: args, env, save: !options["no-save"], signal }));
    if (options.json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      for (const item of report.results) stdout.write(`${item.id}  ${item.status}  ${displayText(item.version ?? item.error ?? "no version")}\n`);
      stdout.write(options["no-save"] ? "Readiness was not saved.\n" : `Saved readiness: ${displayText(report.cachePath)}\n`);
    }
    return report.results.every(item => item.status === "ready") ? 0 : 1;
  }
  if (action === "inspect") {
    if (args.length !== 2 || options["no-save"]) throw new Error("Use seal tools inspect CAPABILITY INPUT [--timeout-ms N].");
    const workspace = await realpath(cwd);
    const timeoutMs = options["timeout-ms"] === undefined ? undefined : Number(options["timeout-ms"]);
    const report = await withCancellation(signal => inspectLocal({ workspace, id: args[0], input: args[1], env, timeoutMs, signal }));
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return ["completed", "partial"].includes(report.status) ? 0 : report.status === "cancelled" ? 130 : 1;
  }
  throw new Error("Unknown tools operation; choose list, check, or inspect.");
}

async function problemCommand(options, positionals, { cwd, stdout }) {
  const [action = "list", ...args] = positionals;
  const workspace = await realpath(cwd);
  if (action === "list") {
    if (args.length || options.category || options.message) throw new Error("Use seal problem list [--json].");
    const problems = await listProblems(workspace);
    if (options.json) stdout.write(`${JSON.stringify({ workspace, problems }, null, 2)}\n`);
    else if (!problems.length) stdout.write("No initialized problem folders.\n");
    else for (const item of problems) stdout.write(`${item.slug}  ${item.category}  ${item.name}\n`);
    return 0;
  }
  if (action === "init") {
    if (options.message) throw new Error("problem init does not accept --message.");
    const name = args.join(" ");
    if (!name) throw new Error("Use seal problem init \"Problem Name\" [--category TEXT].");
    const result = await initProblem(workspace, name, { category: options.category ?? "unknown" });
    if (options.json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else stdout.write(`Problem folder: ${displayText(result.problem.root)}\n${result.created.length ? `Created ${result.created.length} schema entries.` : "Reused existing schema without overwriting files."}\n`);
    return 0;
  }
  if (action === "note") {
    if (options.category) throw new Error("problem note does not accept --category.");
    if (!options.message) throw new Error("Use seal problem note [NAME] --message TEXT.");
    const selector = args.length ? args.join(" ") : null;
    const result = await appendProblemNote(workspace, selector, options.message);
    stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `Appended shared note: ${displayText(result.notesPath)}\n`);
    return 0;
  }
  throw new Error("Unknown problem operation; choose init, list, or note.");
}

export async function main(argv = process.argv.slice(2), {
  cwd = process.cwd(), env = process.env, stdout = process.stdout, stderr = process.stderr,
} = {}) {
  const parsed = parseArguments(argv);
  const { command, options, positionals } = parsed;
  if (options.help) {
    stdout.write(command === "tools" && positionals[0] === "inspect" ? observationHelp(positionals[1]) : HELP);
    return 0;
  }
  if (command === "tools") return toolCommand(options, positionals, { cwd, env, stdout });
  if (command === "problem") return problemCommand(options, positionals, { cwd, stdout });

  const home = getCodexHome(env);
  const childEnv = nativeEnvironment(home, env);
  const executable = env.CTF_CODEX_BIN || "codex";
  if (["version", "update", "daemon"].includes(command)) {
    const args = command === "version" ? ["--version"]
      : command === "update" ? ["update"] : ["app-server", "daemon", positionals[0]];
    return runNative({ executable, args, env: childEnv, cwd, stderr });
  }
  const prepared = await ensureCodexHome({ home });
  const skills = ensureOwnedSkills(home);
  const overrides = await isolationOverrides({ home });
  if (command === "setup" || command === "config") {
    const config = {
      home, configPath: prepared.configPath, instructionsPath: prepared.instructionsPath,
      created: [...prepared.created, ...skills.created], nativeExecutable: executable,
      ownedSkills: [...OWNED_SKILL_NAMES],
      profileDefaultModel: DEFAULT_MODEL, lightweightModel: LIGHTWEIGHT_MODEL,
      modelSelection: "native configuration; --model and --effort explicitly override it",
      requestedCyberAccessProgram: "daybreak_blue", fastServiceTier: "priority",
      requestedModelContexts: MODEL_CONTEXT_LIMITS,
      filesystem: "the launch folder is shared; no SEAL session work directories",
      daemonPolicy: "native-managed; native compatibility may choose embedded mode",
      updatePolicy: "selected native executable and native latest-release updaters; no version pin",
      automaticAgents: false, inheritedUserSkills: "disabled; curated profile-local skills enabled",
      credentials: "native Codex only; no credential copying or linking",
      isolation: "configuration separation, not a same-user security boundary",
    };
    stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  }
  if (command === "login") return runNative({ executable, args: [...overrideArgs(overrides), "login", ...positionals], env: childEnv, cwd, stderr });

  // A validated private-prefix tool should work from native shells too, without
  // changing the user's global PATH or installing another package.
  const launchEnv = withPreparedToolPath(childEnv, homedir());

  const workspace = await realpath(cwd);
  const problemRoot = await findProblemRoot(workspace);
  launchEnv.CTF_WORKSPACE_ROOT = workspace;
  launchEnv.SEAL_CLI = fileURLToPath(new URL("../bin/seal.mjs", import.meta.url));
  if (problemRoot) launchEnv.CTF_PROBLEM_ROOT = problemRoot;
  else delete launchEnv.CTF_PROBLEM_ROOT;
  const title = `CTF ${displayText(path.basename(workspace))}`;
  try {
    if (stdout.isTTY) stdout.write(`\u001b]2;${title}\u0007`);
    stderr.write(`CTF workspace: ${displayText(workspace)}\n`);
    return await runNative({ executable, args: nativeArguments(overrides, workspace, options, command, positionals), env: launchEnv, cwd: workspace, stderr });
  } finally {
    if (stdout.isTTY) stdout.write(`\u001b]2;${title} | stopped\u0007`);
  }
}
