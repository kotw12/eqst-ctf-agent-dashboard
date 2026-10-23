import json
import stat
import sys
import tarfile
import zipfile

MAX_ENTRIES = 512
MAX_NAME = 4096
COUNT_KEYS = {"file": "fileCount", "directory": "directoryCount", "symlink": "linkCount", "special": "specialCount"}


def empty_totals():
    return {"fileCount": 0, "directoryCount": 0, "linkCount": 0, "specialCount": 0, "uncompressedFileBytes": 0}


def count_member(totals, kind, size):
    totals[COUNT_KEYS[kind]] += 1
    if kind == "file":
        totals["uncompressedFileBytes"] += size


def inventory(archive_format, entries, total_entries, complete, totals):
    if totals is not None:
        totals["uncompressedFileBytes"] = str(totals["uncompressedFileBytes"])
    return {"format": archive_format, "totalEntries": total_entries, "complete": complete, "totals": totals, "entries": entries}


def record(name, size, kind, compressed=None, encrypted=False):
    normalized = name.replace("\\", "/")
    unsafe = normalized.startswith("/") or ".." in normalized.split("/") or (len(normalized) > 1 and normalized[1] == ":")
    return {
        "name": name[:MAX_NAME],
        "nameTruncated": len(name) > MAX_NAME,
        "sizeBytes": str(size),
        "compressedBytes": None if compressed is None else str(compressed),
        "kind": kind,
        "encrypted": encrypted,
        "unsafeExtractionPath": unsafe,
    }


def inspect(filename):
    if zipfile.is_zipfile(filename):
        with zipfile.ZipFile(filename) as archive:
            items = archive.infolist()
            entries = []
            totals = empty_totals()
            for item in items:
                kind = "directory" if item.is_dir() else "symlink" if stat.S_ISLNK(item.external_attr >> 16) else "file"
                count_member(totals, kind, item.file_size)
                if len(entries) < MAX_ENTRIES:
                    entries.append(record(item.filename, item.file_size, kind, item.compress_size, bool(item.flag_bits & 1)))
            return inventory("zip", entries, len(items), len(items) <= MAX_ENTRIES and not any(item["nameTruncated"] for item in entries), totals)
    if tarfile.is_tarfile(filename):
        with tarfile.open(filename, "r:*") as archive:
            entries = []
            complete = True
            totals = empty_totals()
            for item in archive:
                if len(entries) == MAX_ENTRIES:
                    complete = False
                    break
                kind = "directory" if item.isdir() else "symlink" if item.issym() or item.islnk() else "file" if item.isfile() else "special"
                count_member(totals, kind, item.size)
                entries.append(record(item.name, item.size, kind))
            return inventory("tar", entries, len(entries) if complete else None, complete and not any(item["nameTruncated"] for item in entries), totals if complete else None)
    raise ValueError("Unsupported or unrecognized archive; this adapter lists ZIP and TAR containers only. Use the archive-inspect CLI card for other formats.")


try:
    result = inspect(sys.argv[1])
    print(json.dumps(result, ensure_ascii=True))
except (OSError, ValueError, zipfile.BadZipFile, tarfile.TarError) as error:
    print(json.dumps({"error": str(error)[:2048], "kind": type(error).__name__}))
    sys.exit(2)
