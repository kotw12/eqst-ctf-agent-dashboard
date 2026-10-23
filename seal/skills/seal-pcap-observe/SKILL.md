---
name: seal-pcap-observe
description: Obtain format, packet count, size and time bounds from a supplied local capture when those facts are needed. Not a mandatory preflight for every offline capture question. This adapter does not capture traffic, contact endpoints or process packet payloads.
---

# Capture overview

Use a supplied capture, not an endpoint or interface name, when count/time metadata answers a current question. Reuse already verified metadata rather than repeating the scan.

`seal tools inspect pcap-summary PROBLEM-SLUG/attachments/INPUT`

Interpret the command status, capture type, encapsulation, packet count and reported times together. Empty captures are valid observations. Missing timestamps remain unknown; do not silently turn them into zero or invent a timezone. Time values are retained as reported strings to avoid losing precision.

Unlike a short file-header read, this summary may scan the entire capture. Input size, storage speed and compression can affect runtime. A timeout is an incomplete observation, not proof that the capture contains nothing useful. Do not automatically repeat the whole scan or raise its budget indefinitely.

This metadata adapter suppresses comments and does not display packet payloads, decode credentials, capture traffic or contact addresses. Other human-assigned offline analysis can use appropriate existing native tools within its own scope; this adapter is not a mandatory gateway. Request the fields/filter needed for the current question and preserve useful extraction results instead of repeatedly scanning the whole capture. Never contact a captured endpoint merely because it appears in the data.

For a rejected TShark field, consult its registry once. Prefer `tshark -G fields,PREFIX` if `-G help` supports it; otherwise save/filter `-G fields` locally. Do not treat a field-schema error as a bad capture, repeat the same invalid field, or send the entire registry to the model.

Keep the original capture unchanged. Retain raw stdout/stderr paths and report truncation or an input-change warning. Filesystem metadata is not a content hash and the tool does not implement a result cache.
