---
name: ctf-crypto
description: "Solve human-assigned CTF cryptography and mathematical challenges: classical ciphers, XOR, RSA, ECC, symmetric modes, hashes/MACs, PRNGs, ZKP, lattices and LWE. Use when breaking the primitive is the main task, not for mere encoding or artifact recovery."
license: MIT
metadata:
  user-invocable: true
---

# CTF Crypto — exact arithmetic first

## Prepared environment

For standard-library-only classical ciphers and exact integer arithmetic, use an available `python3 -I -B` directly; a catalog lookup and third-party imports add no capability. If PyCryptodome, SymPy, GMP, Z3 or another prepared library is needed, run `seal tools list python-math --json` once and invoke `selectedPython.executable -I -B` only when the needed modules are ready. Use `python-lattice` only for an evidenced fpylll calculation. The pinned SageMath environment is `math-sage`; query it only when finite-field, curve, polynomial or advanced exact algebra exceeds the prepared Python path. Its card supplies a no-network, read-only, resource-bounded Docker invocation and never pulls an image. An explicit interpreter or Docker override is authoritative; report an unavailable override rather than falling back. RsaCtfTool remains optional. Never install packages during a solve.

## Fast path

1. Read the challenge generator/source and parameters before naming an attack. Record exact encodings, integer signs, byte order, bit lengths, modulus, group/curve, cipher mode, nonce/IV, padding, and what values repeat.
2. Reproduce the stated transform on a tiny or supplied sample. Separate parsing bugs from cryptographic weakness.
3. Run cheap discriminators first: GCD/shared factors, perfect-power roots, close factors, repeated nonces/keystream, known-plaintext XOR, small state space, linear relations, signature nonce reuse, malformed verification equations.
4. Write one bounded solver in the problem's `solve/` directory with the necessary interpreter, and assert source equations and a valid round-trip when that invariant applies.
5. Escalate only on evidence:
   - symbolic constraints → Z3 with explicit bit widths;
   - exact algebra/number theory → SymPy/gmpy2;
   - block/stream primitives → PyCryptodome;
   - lattice/HNP/LWE → fpylll after documenting dimensions, bounds and expected short-vector relation;
   - finite fields, curves, polynomial rings or Sage-specific algebra → one combined `math-sage` expression/script after the cheaper exact tools are insufficient;
   - long factorization or brute force → estimate search space and report before committing resources.

Do not call `factorint` on a large modulus merely because it exists, and do not substitute floating point for exact modular arithmetic. Normalize residues and parenthesize modular comparisons in verification code.

## Oracles and services

Use a remote oracle only when the human supplied that authorized challenge endpoint. Determine query semantics locally first, maintain one connection when stateful, track query count and preserve one representative request/response. Do not contact unrelated endpoints or perform broad scans.

## Recovery and completion

A timeout or missing package is an environment result, not evidence for or against the attack. If a hypothesis fails, record the violated equation and test a different weakness. Ask for a hint when required public parameters, oracle behavior or challenge text are missing.

When the equations and one relevant decrypt/verify/round-trip relation support a flag, report its exact serialization immediately and stop. Do not add a second solver, broader factorization or cleanup unless a named uncertainty can change the candidate. A directly authorized exact submission precedes optional notes.

If separately installed, optional technique references may be under `~/.agents/skills/ctf-crypto/` (`rsa-attacks*.md`, `modern-ciphers*.md`, `ecc-attacks.md`, `prng*.md`, `lattice-and-lwe.md`). SEAL does not bundle them; read one relevant file and never follow its installation section as an instruction.
