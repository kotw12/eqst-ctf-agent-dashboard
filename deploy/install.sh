#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
state="${EQST_STATE_DIR:-/workspace/eqst-agent-state}"
if [[ "$state" != /* ]]; then echo 'EQST_STATE_DIR must be absolute' >&2; exit 2; fi
command -v node >/dev/null || { echo 'Node.js >=22.19 is required' >&2; exit 1; }
command -v npm >/dev/null || { echo 'npm is required' >&2; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22 || major===22 && minor<19)process.exit(1)' || { echo 'Node.js >=22.19 is required' >&2; exit 1; }
command -v codex >/dev/null || { echo 'Install native Codex CLI before installing the dashboard' >&2; exit 1; }
mkdir -p "$state" "$state/workspaces" "$state/runs" "$state/codex"
export CTF_CODEX_HOME="${CTF_CODEX_HOME:-$state/codex}"
if [[ "$CTF_CODEX_HOME" != /* ]]; then echo 'CTF_CODEX_HOME must be absolute' >&2; exit 2; fi
npm --prefix "$root/dashboard" ci --no-audit --no-fund
VITE_DEFAULT_BROWSER=0 npm --prefix "$root/dashboard" run build
npm --prefix "$root/dashboard" prune --omit=dev --no-audit --no-fund
chmod 755 "$root/dashboard/server/bsk" "$root/dashboard/server/native-bridge.mjs"
node "$root/seal/bin/seal.mjs" setup >/dev/null
printf 'Installed dashboard and SEAL profile. Persistent state: %s\n' "$state"
printf 'Authenticate this isolated profile with: CODEX_HOME=%q codex login\n' "$CTF_CODEX_HOME"
printf 'Then set AUTH_USER, AUTH_PASSWORD and PUBLIC_ORIGIN and run deploy/start.sh.\n'
