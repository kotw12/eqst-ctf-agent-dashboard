---
name: ctf-writeup
description: Produce a concise reproducible CTF handoff after a solution is already supported. Use only when the human asks for a writeup; never delay the answer, publish externally, or infer acceptance.
license: MIT
metadata:
  user-invocable: true
  argument-hint: "[challenge name]"
---

# CTF writeup — after the solve

Do not invoke this as a mandatory solving step. Use verified shared `NOTES.md`, the final solver and relevant problem files; do not rescan the whole workspace merely to fill a template.

Create `writeup.md` in the initialized problem folder unless the human specifies another path. Keep it reproducible and short:

1. Challenge name/event/category and the supplied flag format; mark unknown metadata as unknown rather than inventing it.
2. One- or two-sentence core observation.
3. The minimal ordered steps from supplied input to supported answer, with exact commands or one complete solve script where useful.
4. The decisive output/evidence and tool versions only when behavior depends on them.
5. Failed approaches only if they explain a meaningful pivot or environment limitation.
6. Flag/candidate status exactly as requested. A local candidate is not accepted unless an operator receipt says so.

Remove credentials, tokens, private infrastructure, unrelated personal data and raw logs that do not aid reproduction. Do not publish, upload, commit or submit the writeup. No placeholders or claims about tests/checks that were not run.

If separately installed, an optional older template may be under `~/.agents/skills/ctf-writeup/SKILL.md`. SEAL does not bundle it, and its shell scans are not required.
