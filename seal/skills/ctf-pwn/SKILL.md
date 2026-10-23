---
name: ctf-pwn
description: Exploit a human-assigned native CTF binary or service after the vulnerability or low-level primitive is understood. Use for memory corruption, format strings, heap, ROP, shellcode, seccomp or kernel challenge paths; use ctf-reverse first when behavior is still unknown.
license: MIT
metadata:
  user-invocable: true
---

# CTF Pwn — local primitive before remote exploit

Do not execute an unknown binary merely to classify it. Human assignment of a CTF binary permits challenge analysis, not unrelated host or network access.

## Prepared environment

- Static: use the focused `seal tools list elf-header pwn-checksec --json` only if `file`, `readelf`, `objdump` or protection-summary paths are uncertain; `seal-binary-observe` supplies bounded ELF header facts. Run checksec only after ELF magic is established.
- Python: query `seal tools list python-pwn --json` for the selected pwntools, Capstone, Unicorn and pyelftools interpreter; use its exact `selectedPython.executable -I -B`. angr is optional metadata and needs an explicit find/avoid hypothesis. An explicit override does not silently fall back.
- Debugging: `debugger-pwndbg` is the prepared interactive path; `debugger-gdb` is the raw-system fallback. Use the card's early `set debuginfod enabled off` argument so target startup does not fetch symbols. Query one, keep one process, and distinguish extension startup from successful inferior start/ptrace permission.
- Gadgets: query `pwn-ropgadget` or `pwn-ropper` only after control-flow/stack control and the required gadget class are known. Use one narrow search; do not dump both tools or treat a candidate as a valid chain without side-effect/alignment checks.

## Fast path

Before authorized local execution, inspect mode bits. If the preserved attachment is not executable, copy it under the problem's `solve/` or `artifacts/`, verify the copied hash, and add execute permission only to the copy. Do not mutate source attachments or assume launching the ELF interpreter is equivalent for every target.

1. Hash/preserve the original; identify architecture, linkage, interpreter, protections, supplied libc/loader and source. Use strings/imports/disassembly only around relevant code.
2. Reproduce the vulnerability locally with the smallest input. Separate crash, controlled instruction pointer, information leak and arbitrary read/write as distinct primitives.
3. Measure offsets with deterministic cyclic data and record exact crashing value/endian interpretation. Do not infer an offset from one visual guess.
4. Write one `exploit.py` supporting local and provided remote modes without duplicating payload logic. Pin supplied loader/libc when present; preserve actual leaks and compute bases explicitly.
5. Keep one Pwndbg/GDB session for iterative work rather than reconnecting for every observation. Escalate to a narrow ROP gadget query, heap/FSOP work or symbolic execution only after protections and the proven primitive require it.
6. Validate locally to the strongest available boundary. Contact only the human-provided challenge service, maintain one stateful connection when useful, and do not spray hosts or ports.

## Recovery and completion

A debugger startup failure, wrong libc, architecture mismatch, remote reset and exploit-logic failure are different. Record the last proven primitive and the first failing invariant. If behavior is still not understood, pivot to `ctf-reverse`; if the service is a language jail rather than memory corruption, use `ctf-misc`.

A batch GDB command can exit 0 even when its inferior never started. Check the actual stop/frame and stderr before calling a printed global a runtime observation. If `ptrace: Operation not permitted` appears, classify it as a debugger permission boundary once; do not keep retrying GDB, swap to QEMU for a native binary without a separate reason, or treat a static `print` as a live value. Preserve exact QEMU errors (for example, `Exec format error` is not evidence of a socket denial). Report what static analysis established and what remains unobserved; an explicit user-selected execution mode is separate from the challenge-solve instruction.

When the exploit or authorized service returns a supported flag, preserve that exact response and report the serialized flag immediately; this is the stop condition. Do not spend the remaining budget on exploit cleanup, reliability tuning, another leak, a second run or NOTES before reporting. If one exact submission was directly authorized, submit once and report acceptance/rejection before optional cleanup; otherwise never claim acceptance or auto-submit.

If separately installed, optional primitive references may be under `~/.agents/skills/ctf-pwn/`. SEAL does not bundle them; read only a relevant file, never run its bundled exploits or installers as setup.
