#!/usr/bin/env node
import { spawn } from "node:child_process";
const args = process.argv.slice(2);
const thread = process.env.SEAL_LIVE_RESUME;
const at = args.indexOf("exec");
if (thread && at >= 0) {
  args.splice(at + 1, 0, "resume");
  const separator = args.indexOf("--", at);
  if (separator >= 0) args.splice(separator + 1, 0, thread);
  else args.push(thread);
  for (let n = 0; n < args.length; n++)
    if (args[n] === "--yolo")
      args[n] = "--dangerously-bypass-approvals-and-sandbox";
}
const child = spawn(process.env.SEAL_LIVE_NATIVE_CODEX || "codex", args, {
  stdio: "inherit",
  env: process.env,
});
child.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 127;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 130 : 1);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
