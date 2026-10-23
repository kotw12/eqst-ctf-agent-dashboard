---
name: seal-file-observe
description: Observe supplied local files using bounded MIME/encoding, hex-prefix, PNG integrity or ZIP/TAR inventory interfaces. Choose the observation needed; no extraction, repair, target execution or remote scan.
---

# File observation

Choose only the observation needed. For uncertain type/encoding use the MIME adapter; for known small text a bounded native read is sufficient. An extension alone is not proof of format. Resolve the path inside the shared problem folder.

`seal tools inspect file-identify PROBLEM-SLUG/attachments/INPUT`

Check `status`, `facts.mimeType`, `facts.encoding`, and the input identity. An extension is only a hint: a `.bin` file does not establish an AI/ML category. Generic `application/octet-stream` is uncertainty, not a classification failure to conceal.

The interface uses file magic without decompression or target execution. It accepts regular files within the selected problem; URLs, devices, and escaping symlinks are not inputs. Do not add broad recursive extraction or execute a file merely to learn its format.

Generated observation output stays in the initialized problem folder's `.seal/observations/`. Raw stdout/stderr are separate from the bounded preview. Filesystem stat identity is not a cryptographic digest, and results are not automatically cached. If the input changes during the command, do not reuse the observation as stable evidence.

Invocation: `seal tools inspect ID INPUT [--timeout-ms N]`. `N` is whole-command wall time in milliseconds, 1..120000, not a foreground yield interval. File/hex default to 5000ms; PNG/archive default to 15000ms. `timeout` is not a corrupt-file verdict. Preserve the result and choose any warranted retry explicitly; never blindly repeat it.

For exact header bytes, use `seal tools inspect hex-preview INPUT` (up to 256 bytes); this locates the prepared xxd even when it is not on PATH. A known native bounded reader is also sufficient. Never dump an entire file for a small question.

For PNG/JNG/MNG integrity, use `seal tools inspect png-check INPUT`. Read `facts.accepted` and `status`: `rejected` is a negative validator result, while dependency warnings remain separate. This is not a QR decoder or image repair tool.

For ZIP/TAR members, use `seal tools inspect archive-index INPUT`. It does not extract and preserves names as JSON data. Read `complete`, `totalEntries`, `totals`, per-member flags and truncation indicators. At most 512 entries are listed; `partial` does not prove all members were displayed. Non-null `totals` covers the whole archive: file/directory/link/special member counts and `uncompressedFileBytes` (a decimal string of declared file sizes). ZIP can have complete totals with a partial displayed list; a capped TAR has `totals: null`, meaning unknown, not zero. Do not rescan when existing totals answer the question. For other formats, read the focused `archive-inspect` native CLI card.

For counts or a short inventory, project the needed fields on the first invocation instead of dumping the whole report and reading it again after terminal truncation. Keep `status`, completeness, totals and the saved report path; preserve the producer's exit status when piping. Append any requested `--timeout-ms N` before the pipe:

```sh
set -o pipefail
seal tools inspect archive-index INPUT |
  jq '{status, reportPath, complete: .facts.complete, totalEntries: .facts.totalEntries, totals: .facts.totals, sample: .facts.entries[:5]}'
```

`invalid_input` is not a valid empty archive. If format remains uncertain, MIME/header evidence can resolve it; do not repeat the same parser in another library merely to reconfirm a clear rejection.

Choose a more specific observation only when the format and current question justify it. Keep source files unchanged and record uncertainty rather than manufacturing a type or a solution.
