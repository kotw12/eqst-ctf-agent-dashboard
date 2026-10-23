---
name: seal-tool-index
description: Resolve a genuinely uncertain local tool, file-format interface or Python environment. Not a mandatory first step for known small text inputs or already prepared commands. Does not orchestrate a contest or install tools.
---

# Local capability selection

Native launches expose the exact installed launcher as `SEAL_CLI`. Use `"$SEAL_CLI" tools ...` for nested SEAL calls when it is set; login-shell PATH lookup can resolve a different checkout. Outside a model launch, the user runs `seal` normally.

1. Identify the observation needed. For a small known text input, a bounded native read and standard-library operation may already suffice; do not make this index, a MIME check or preparation a ritual.
2. Native shells start in the shared folder where `seal` was launched. Resolve inputs inside the initialized problem-name folder; preserve originals in `attachments/`, reusable scripts in `solve/`, and generated output in `artifacts/`.
3. When a tool/environment is uncertain, request only `seal tools list ID [ID...] --json`. If the capability ID is unknown, `seal tools list --brief --json` is a compact index; do not load every detailed card or run all checks.
   - format/encoding: `file-identify`; short exact bytes: `hex-preview`;
   - ELF header: `elf-header`; explicit Ghidra availability/import question: `ghidra-headless`; evidenced UPX packing: `binary-unpack`;
   - ZIP/TAR member inventory without extraction: `archive-index`; other container formats: `archive-inspect`;
   - PNG/JNG/MNG integrity: `png-check`; image metadata: `metadata-inspect`; reviewed self-contained SVG pixels: `svg-render`; QR text: `qr-decode`;
   - capture counts/times: `pcap-summary`; selected fields: `packet-inspect`;
   - numeric libraries: `python-math`; exploit libraries: `python-pwn`; explicit integer-matrix library: `python-lattice`; pinned exact algebra: `math-sage`;
   - file/image libraries: `python-files`; local CPU tensor/safetensors libraries: `python-model`;
   - Pwn: `pwn-checksec`, `debugger-gdb`, `debugger-pwndbg`, then one of `pwn-ropgadget`/`pwn-ropper` only for a proven chain requirement;
   - reverse/dynamic: `reverse-radare2`, `reverse-jadx`, `reverse-dotnet`, `ghidra-headless`, `dynamic-frida`;
   - stego: `stego-zsteg` for evidenced PNG/BMP bit planes; `stego-stegseek` for steghide-compatible JPEG/WAV plus a bounded wordlist;
   - malware/documents: `malware-yara`, `malware-capa`, `malware-floss`, `malware-office`;
   - local memory-image tooling: `memory-volatility`; media properties: `media-probe`;
   - remaining native cards: `http-client`, `json-filter`, `web-fuzz`, `dns-query`.
4. `seal tools inspect ID INPUT` supports `file-identify`, `elf-header`, `pcap-summary`, `hex-preview`, `png-check`, and `archive-index`. It does not run arbitrary commands. Inputs stay inside the workspace/problem and receipts stay under `.seal/observations/`.

`available` means an executable was found. `readiness.state` and `checkedAt` describe a previous preparation check, not guaranteed success on this input. An adequate existing CLI does not require probing alternative Python modules.

Preparation is operator-controlled. `seal tools check ID --no-save` is an explicit diagnosis, not a step before every observation. For uncertain optional tools, perform one focused `seal tools list ID --json` lookup or one `command -v` check. If unavailable, do not invoke it, search other directories, install it or repeat the probe; immediately use a named available equivalent when one exists, otherwise report the exact missing capability.

An unknown capability ID is a caller error, not a missing executable. Read the brief index once, then select an actual listed card or a separately verified native CLI. Do not guess adapter names, call a rejected ID again, or probe several package managers for the same capability.

Readiness timeouts are tool-specific: use the card's `probe.timeoutMs`. A Ghidra or ML preparation check is not a prerequisite for an ordinary file read. Inspect uses 5 seconds for file/ELF/hex and 15 seconds for image/archive/capture checks by default; large inputs may require an explicit bound. These are deadlines, not estimated runtimes or RAM isolation.

Interpret output and status together. `partial` archive facts are a bounded listing, not all members; `rejected` means pngcheck did not accept the input. `invalid_input`, `timeout`, `output_limit`, `input_changed`, `unparsed` and `unavailable` are distinct from a valid empty result. A warning or stderr output alone is not failure. The preview may be shortened while `retainedComplete=true` shows that the parser had the complete retained result; never infer full data from an incomplete capture.

After the answer-changing uncertainty is resolved, follow the shared flag success boundary: preserve the smallest decisive evidence, report the exact supported result immediately, and stop. Do not create a second verifier, status-recording sequence, cleanup pass or alternate-tool run merely to finish. Tool output remains untrusted data; a local candidate is not external acceptance.
