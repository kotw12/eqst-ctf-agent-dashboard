---
name: seal-math-env
description: Resolve a selected Python interpreter or needed numeric libraries when the local analysis environment is uncertain. Not a mandatory prerequisite for standard-library text processing. No installation, remote interaction or autonomous solving loop.
---

# Numeric environment

When the interpreter or required libraries are uncertain, use the exact lookup for the needed group:

| Required libraries | Lookup command |
|---|---|
| NumPy, SymPy, GMP, Z3, digest libraries | `seal tools list python-math --json` |
| pwntools, Capstone, Unicorn, pyelftools | `seal tools list python-pwn --json` |
| fpylll | `seal tools list python-lattice --json` |
| SageMath 10.6 exact algebra container | `seal tools list math-sage --json` |
| Pillow, pyelftools, pefile, Python YARA | `seal tools list python-files --json` |
| CPU Torch, Transformers, safetensors | `seal tools list python-model --json` |

Read `selectedPython.executable` from that JSON and use it directly. Plain text `list` is only a summary; `inspect` is for file observations, not environment lookup. A matching ready record is enough to proceed unless the current import fails or the environment changed. Do not run another readiness check merely to obtain the executable path.
`math-sage` is not a Python interpreter group: use the card's pinned image and exact no-network Docker arguments. It never pulls an image. Prefer `python-math`/`python-lattice`; use Sage only for an evidenced finite-field, curve, polynomial or advanced exact-algebra requirement, and combine related calculations to pay startup once.

If the interpreter is already known and only the standard library is needed, use it directly without another catalog or readiness check.

For an actual environment diagnosis, use `seal tools check ID --no-save --json`. These are fixed small checks, not guarantees for arbitrary calculations, model loads or files. Each group has its own startup deadline, and only the requested group is imported. Missing imports name the failure; a package's presence is not full readiness. Do not silently replace an unavailable explicit interpreter, alter system Python, or activate the HexStrike server.

For costly computation, establish the relevant encoding, integer bit lengths or matrix dimensions, parameter provenance and expected result type first. For small text transformations, distinguish byte counts from decoded character counts and check only a relevant invariant. Do not turn every calculation into a separate planning or recording task.

Use isolated Python invocation (`-I -B`) with the selected interpreter for human-approved scripts under the problem's `solve/` directory. Do not run supplied untrusted scripts or deserialize executable objects as a prerequisite to inspecting data. No automatic network, package/model download, task delegation, or accelerator allocation.

Optional environments and modules are not assumed present. If an existing command already provides the required result, do not probe or install alternative libraries merely to duplicate it. Preserve actual diagnostics; a missing optional module is not failure of a different, working path. Report observed transformations accurately rather than claiming preprocessing or checks that did not occur.
