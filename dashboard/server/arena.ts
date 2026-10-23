import type { Express } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { RunStore } from "./store.ts";

const arenaSchema = z.object({
  flags: z.record(z.string()),
  accepted: z.array(z.string()),
  attempts: z.record(z.number()),
});
const challenges = [
  {
    id: "signal-drift",
    name: "Signal Drift",
    category: "crypto",
    points: 100,
    brief:
      "A transmission lost in translation. Reconstruct the original message.",
  },
  {
    id: "byte-trail",
    name: "Byte Trail",
    category: "reverse",
    points: 150,
    brief: "One byte key. A trail of numbers. Find what the program is hiding.",
  },
];
function escape(value: string) {
  return value.replace(
    /[<>&"']/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[
        c
      ] || c,
  );
}
const styles = `:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b1420;color:#edf1f6;font:16px system-ui,sans-serif}main{max-width:940px;margin:54px auto;padding:0 32px}nav{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #253447;padding:23px 32px}nav a{font-size:19px;font-weight:800;color:#e4edff;text-decoration:none}nav small{color:#91a9c2;font-size:13px}.badge{display:inline-block;border:1px solid #305174;border-radius:5px;padding:5px 9px;color:#7dc6ee;font-size:12px}h1{font-size:48px;letter-spacing:-2px;margin:18px 0 10px}p{color:#9fb1c5;line-height:1.8}section{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:32px}.card{background:#121f30;border:1px solid #2a3d55;border-radius:14px;padding:28px;color:inherit;text-decoration:none}.card:hover{border-color:#77bbff}h2{font-size:25px;margin:18px 0}.points{float:right;color:#f5bf6c}code,pre{font-family:monospace;color:#b0d7ff}pre{background:#101e2e;border:1px solid #2a3d55;padding:22px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.submit{display:flex;gap:12px;margin:24px 0}input{flex:1;min-width:0;background:#111e2e;color:white;border:1px solid #39546f;border-radius:8px;padding:14px;font-size:16px}button{background:#87b8ed;color:#081a2f;border:0;border-radius:8px;font-weight:700;padding:14px 22px;cursor:pointer}#result{font-weight:700;color:#86dfbe}.back{color:#a8caeb}.footer{border-top:1px solid #253447;margin-top:52px;padding-top:20px;font-size:12px;color:#7e96b0}`;
export function mountArena(app: Express, store: RunStore) {
  const load = (id: string) => {
    const view = store.get(id);
    if (!view.meta.config.demo) throw new Error("Not a local demonstration");
    const file = path.join(store.dir(id), "arena.json");
    if (!fs.existsSync(file))
      fs.writeFileSync(
        file,
        JSON.stringify({
          flags: {
            "signal-drift": `SEAL{signal_${randomBytes(4).toString("hex")}}`,
            "byte-trail": `SEAL{trace_${randomBytes(4).toString("hex")}}`,
          },
          accepted: [],
          attempts: {},
        }),
        { mode: 0o600 },
      );
    return {
      state: arenaSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))),
      file,
    };
  };
  app.get(["/arena/:id", "/arena/:id/:challenge"], (req, res) => {
    try {
      const id = String(req.params.id),
        { state } = load(id),
        selected = challenges.find((c) => c.id === req.params.challenge);
      if (req.params.challenge && !selected) {
        res.sendStatus(404);
        return;
      }
      store.add(
        id,
        selected ? "challenge" : "notice",
        selected ? `문제 탐색 · ${selected.name}` : "대회 사이트 탐색",
        "실제 로컬 CTF 웹 요청",
        selected
          ? {
              challenge: selected.name,
              category: selected.category,
              points: selected.points,
              source: "platform",
            }
          : {},
      );
      const base = `/arena/${id}`;
      const content = selected
        ? `<a class="back" href="${base}">← All challenges</a><h1>${selected.name}</h1><span class="badge">${selected.category}</span> <span class="badge">${selected.points} pts</span><p>${selected.brief}</p>${selected.id === "signal-drift" ? `<p>The message was encoded with Base64. Decode the transmission and submit the exact flag.</p><pre>${Buffer.from(state.flags[selected.id]).toString("base64")}</pre>` : `<p>The following byte array was XORed with the key <code>0x37</code>. Recover the original UTF-8 text.</p><pre>[${[...Buffer.from(state.flags[selected.id])].map((b) => b ^ 0x37).join(", ")}]</pre>`}<p>Flag format: <code>SEAL{…}</code>. Submit the decoded value without altering its delimiters.</p><form class="submit" id="flag-form"><input id="flag" name="flag" placeholder="SEAL{your_flag}" aria-label="Flag" required autocomplete="off"/><button type="submit">Submit flag</button></form><p id="result" role="status">${state.accepted.includes(selected.id) ? "Accepted · already solved" : ""}</p><script>document.getElementById('flag-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const r=await fetch('${base}/${selected.id}/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({flag:document.getElementById('flag').value})});const v=await r.json();document.getElementById('result').textContent=v.message;}catch(e){document.getElementById('result').textContent='Connection failed';}finally{button.disabled=false;}});</script>`
        : `<span class="badge">Local demonstration · real agent execution</span><h1>The signal is yours to find.</h1><p>Two small challenges. No simulated solving, no pre-recorded agent log.<br/>Explore, recover the flag, and submit it here.</p><section>${challenges.map((c) => `<a class="card" href="${base}/${c.id}"><span class="badge">${c.category}</span><span class="points">${c.points} pts</span><h2>${c.name}</h2><p>${c.brief}</p><strong>${state.accepted.includes(c.id) ? "Accepted" : "Open challenge →"}</strong></a>`).join("")}</section><p>Solved: ${state.accepted.length}/${challenges.length} · Score: ${challenges.filter((c) => state.accepted.includes(c.id)).reduce((sum, c) => sum + c.points, 0)}</p>`;
      res
        .type("html")
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escape(selected?.name || "SEAL Signal Lab")}</title><style>${styles}</style></head><body><nav><a href="${base}">SEAL / Signal Lab</a><small>Local CTF • Not a benchmark</small></nav><main>${content}<footer class="footer">Isolated demonstration. Only this local competition is in scope.</footer></main></body></html>`,
        );
    } catch {
      res.status(404).send("Demonstration not found");
    }
  });
  app.post("/arena/:id/:challenge/submit", (req, res) => {
    try {
      const id = String(req.params.id),
        { state, file } = load(id),
        c = challenges.find((c) => c.id === req.params.challenge);
      const body = z.object({ flag: z.string().max(300) }).parse(req.body);
      if (!c) {
        res.status(404).json({ message: "Challenge not found" });
        return;
      }
      const view = store.get(id);
      if (view.meta.config.submissionMode === "off") {
        res
          .status(403)
          .json({ message: "Submission not authorized for this run" });
        return;
      }
      if (
        view.meta.config.submissionMode === "manual" &&
        view.challenges.find((challenge) => challenge.name === c.name)
          ?.decision !== "approved"
      ) {
        res.status(403).json({ message: "Dashboard approval required" });
        return;
      }
      if (state.attempts[c.id]) {
        res.status(409).json({
          message: state.accepted.includes(c.id)
            ? "Accepted · already submitted"
            : "Already attempted. No automatic retry.",
        });
        return;
      }
      const accepted = body.flag === state.flags[c.id];
      state.attempts[c.id] = 1;
      if (accepted) state.accepted.push(c.id);
      fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
      const evidence = `Local platform HTTP receipt: ${accepted ? "Accepted" : "Rejected"}. Challenge ${c.id}, attempt 1.`;
      store.add(
        id,
        "submission",
        accepted ? `Accepted · ${c.name}` : `Rejected · ${c.name}`,
        evidence,
        {
          challenge: c.name,
          category: c.category,
          points: c.points,
          flag: body.flag,
          outcome: accepted ? "accepted" : "rejected",
          evidence,
          source: "platform",
        },
      );
      res.json({
        message: accepted
          ? "Accepted: correct flag"
          : "Rejected: incorrect flag",
        accepted,
      });
    } catch {
      res.status(400).json({ message: "Invalid submission" });
    }
  });
}
