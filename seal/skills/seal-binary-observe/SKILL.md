---
name: seal-binary-observe
description: Read architecture, ABI, type and entry metadata from a supplied local ELF using SEAL's elf-header observation. Use for static format understanding before heavier analysis. No target execution, debugger attachment, exploit construction, or remote interaction.
---

# Static ELF facts

If format is unknown, use the file-observation skill first; do not repeat it if the format was already verified. For an ELF-specific question:

`seal tools inspect elf-header PROBLEM-SLUG/attachments/INPUT`

Interpret `class`, `dataEncoding`, `osAbi`, `type`, `machine` and `entryPoint` as header observations. They are not proof of source semantics, exploitability, or a solved challenge. Keep addresses distinct from file offsets and preserve the raw header output.

A non-ELF input, nonzero exit, timeout or unexpected output layout is a specific interface result, not a reason to fabricate disassembly. This capability never executes the input program and does not follow a debugger or symbolic-execution workflow.

`seal tools list ghidra-headless --json` locates the prepared headless launcher and reports a fixed static-import readiness check. It does not imply completed analysis, function-query caching, a debugger interface, emulation, or a license for other products. Use readelf for simple ELF facts. Ghidra project paths containing hidden components may be rejected; its analysis timeout is separate from process exit, and Java/analyzer warnings do not by themselves mean the process failed.
