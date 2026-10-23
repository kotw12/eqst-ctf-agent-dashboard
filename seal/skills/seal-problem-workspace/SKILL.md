---
name: seal-problem-workspace
description: Organize a human-assigned CTF challenge inside the shared folder where seal was launched. Determine the actual problem name, create/reuse its common folder with `seal problem init`, and coordinate challenge.md, attachments, solve, artifacts, NOTES.md and optional writeup.md without per-session directories.
license: MIT
metadata:
  user-invocable: true
---

# Shared problem workspace

The folder where SEAL was launched is the common contest workspace for every human-started agent. Never create `runs/`, per-session `work/`, owner folders, or copies of a problem per agent.

For nested SEAL commands in a native launch, use the supplied `SEAL_CLI` absolute launcher (`"$SEAL_CLI" problem init ...`, `"$SEAL_CLI" problem note ...`). A login shell can resolve a different `seal` installation on PATH; do not silently mix their profile/tool contracts.

## Starting a problem

1. Determine the actual challenge name from direct user input or authorized contest material. A problem number is an index, not a permanent folder name. If only the number is known and no trusted mapping/list is available, ask the user or inspect the authorized challenge list instead of inventing a name.
2. If the assigned folder is already initialized and its `.seal/problem.json` identifies the problem, reuse it directly. Do not repeat initialization for each observation or calculation. For a new problem or missing required schema, run from the shared contest workspace:

   `seal problem init "Actual Problem Name" --category CATEGORY`

   The command safely creates or reuses `<problem-slug>/` and never overwrites existing shared files. Do not turn schema discovery into a mandatory full-folder checklist.
3. Record the statement, source URL, access information and flag format in `<problem-slug>/challenge.md`. Preserve downloaded originals under `attachments/`.
4. Read `challenge.md` and `NOTES.md` before analysis. If another agent updated them, incorporate the new facts rather than replacing the file wholesale.

When starting from the shared contest folder, attachments live at `<problem-slug>/attachments/`, not a root-level `attachments/`. Once the name and supplied file paths are known, open those paths directly rather than running both a root glob and a second directory walk merely to rediscover them.

## Common schema

- `.seal/problem.json` — stable problem identity and display name; no session data.
- `challenge.md` — statement, category, source, access and flag format.
- `attachments/` — original files; do not overwrite or make executable in place.
- `solve/` — reusable scripts with descriptive strategy names, not generic `attempt-1` names.
- `artifacts/` — extracted files, traces, generated images and bounded raw outputs.
- `NOTES.md` — shared status, verified facts, attempts, candidates and next actions.
- `writeup.md` — created only after a supported solve when the human requests it.

Use `seal problem note ["Problem Name"] --message "..."` to append a compact shared update atomically. Include the observed fact or failed assumption, evidence path, and useful next action. It does not rewrite prior notes: do not reread the entire statement and notes merely to perform this append. Read again when resolving new conflicting information or editing existing text. Do not paste long raw output or secrets into NOTES.md.

Workspace bookkeeping never delays a supported flag. Report the exact candidate and decisive evidence first; if an exact submission was directly authorized, submit once and report the observed result next. Append NOTES, clean solvers or write a requested write-up only afterward. If the process may stop, the user-visible flag report is more important than a completed note.

## Multiple agents

All agents share the same problem files. Before modifying existing text, re-read it and make narrow edits; preserve descriptive solver filenames and avoid replacing another strategy's script. Use the atomic note command for append-only updates. One agent's candidate is not accepted status. When a supported candidate appears, follow the shared flag success boundary instead of waiting for another agent or more cleanup. Submission is not automatic, but when the human directly authorizes an exact challenge/candidate, the acting agent prioritizes one submission through the authorized browser and records the observed acceptance or rejection afterward.

`seal problem list --json` lists initialized problem folders. Folder creation is local organization only: it does not download a challenge, start another agent, connect to a service, create an instance or submit a flag.
