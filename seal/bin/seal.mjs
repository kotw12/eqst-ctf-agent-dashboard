#!/usr/bin/env node
import { main } from "../codex/cli.mjs";

try {
  process.exitCode = await main();
} catch (error) {
  const message = String(error?.message ?? error).replace(/[\p{Cc}\p{Cf}]/gu, "?");
  process.stderr.write(`seal: ${message}\n`);
  process.exitCode = 1;
}
