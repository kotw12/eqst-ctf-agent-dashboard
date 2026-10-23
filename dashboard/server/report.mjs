#!/usr/bin/env node
import fs from "node:fs";
const [kind, json] = process.argv.slice(2);
try {
  if (
    ![
      "challenge",
      "candidate",
      "submission",
      "catalog",
      "progress",
      "finding",
      "solution",
    ].includes(kind)
  )
    throw new Error(
      "Use challenge, candidate, submission, catalog, progress, finding or solution followed by one JSON object.",
    );
  if (!json || Buffer.byteLength(json) > 16384)
    throw new Error("Payload must be at most 16384 bytes.");
  const data = JSON.parse(json);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("JSON object required.");
  if (!process.env.SEAL_LIVE_SIGNALS)
    throw new Error("Not running inside SEAL LIVE.");
  fs.appendFileSync(
    process.env.SEAL_LIVE_SIGNALS,
    JSON.stringify({ kind, data }) + "\n",
    { mode: 0o600 },
  );
  console.log("Display updated.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
