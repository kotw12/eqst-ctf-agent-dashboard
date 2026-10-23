#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
state="${EQST_STATE_DIR:-/workspace/eqst-agent-state}"
if [[ "$state" != /* ]]; then echo 'EQST_STATE_DIR must be absolute' >&2; exit 2; fi
config="${EQST_CONFIG_FILE:-$state/dashboard.env}"
if [[ -f "$config" ]]; then
  # Operator-owned local configuration, never copied into or committed with the release.
  set -a
  . "$config"
  set +a
fi
: "${PUBLIC_ORIGIN:?Set PUBLIC_ORIGIN to the RunPod HTTPS proxy URL}"
: "${AUTH_PASSWORD:?Set a non-default AUTH_PASSWORD before public exposure}"
if [[ "$AUTH_PASSWORD" == eqst ]]; then echo 'Default dashboard password cannot be exposed publicly' >&2; exit 2; fi
if [[ "$PUBLIC_ORIGIN" != https://* ]]; then echo 'PUBLIC_ORIGIN must be an HTTPS URL' >&2; exit 2; fi
export EQST_DATA_DIR="${EQST_DATA_DIR:-$state/runs}"
export EQST_WORKSPACE_ROOT="${EQST_WORKSPACE_ROOT:-$state/workspaces}"
export CTF_CODEX_HOME="${CTF_CODEX_HOME:-$state/codex}"
export AUTH_USER="${AUTH_USER:-eqst}"
export AUTH_SECURE_COOKIE=1
export HOST=0.0.0.0
export PORT="${PORT:-4173}"
export PUBLIC_ORIGIN
export SEAL_BIN="$root/seal/bin/seal.mjs"
export CTF_CODEX_BIN="${CTF_CODEX_BIN:-$(command -v codex || true)}"
if [[ ! -x "$SEAL_BIN" || -z "$CTF_CODEX_BIN" ]]; then echo 'Install the package and native Codex CLI first' >&2; exit 1; fi
if ! "$SEAL_BIN" login status; then
  echo "SEAL is not authenticated in $CTF_CODEX_HOME; run CODEX_HOME=$CTF_CODEX_HOME codex login as this OS user" >&2
  exit 1
fi
exec npm --prefix "$root/dashboard" start
