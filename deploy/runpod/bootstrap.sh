#!/usr/bin/env bash
# EQSTHAL 대회 포털 + 경량 문제 서버 10개 + CTF agent 대시보드를 RunPod Pod 하나에 올리는 부트스트랩.
# RunPod Pod의 시작 명령으로 실행한다 (image: runpod/base:1.0.2-ubuntu2404, /workspace = 네트워크 볼륨).
#
# - 문제 서버: Pod 안에서 Docker를 쓸 수 없어 udocker(PRoot)로 llmctf 이미지를 root로 실행한다.
# - 포털: 표준 라이브러리 Python 앱을 root로 두 개 띄운다. 같은 DB를 공유한다.
#     공개 포털 0.0.0.0:18080 (사람용, 문제 주소 = Pod 공인 IP:포트)
#     로컬 포털 127.0.0.1:18081 (에이전트용, 문제 주소 = 127.0.0.1:포트. Pod 안에서는 자기 공인 IP로 못 들어온다)
#   관리자 화면(제출 원문 조회)은 두 포털 모두 막는다. 에이전트도 127.0.0.1에서 접속하기 때문이다.
# - 에이전트: 대시보드와 Codex를 일반 사용자 agent로 실행한다 (4173/http). 다계정·브라우저 제거·항상 --yolo·
#   EQST HAL 데모 고정은 대시보드 repo에 반영되어 있다(이전의 patch_dashboard.mjs는 더 쓰지 않는다).
#   문제 이미지, 포털 DB(제출 원문), 문제 repo는 root만 읽을 수 있게 막아 에이전트가 직접 들여다보지 못하게 한다.
#
# 환경변수: BOOTSTRAP_GZ(이 스크립트, gzip 후 base64), DASHBOARD_USERS("id:pw,id2:pw2"),
#           EQST_LMS_ID / EQST_LMS_PW(LMS 프리셋용), PORTAL_RESET(값을 바꾸면 포털 기록을 한 번 초기화)
# 시작 명령: echo "$BOOTSTRAP_GZ" | base64 -d | gunzip > /bootstrap.sh && exec bash /bootstrap.sh
# 새 Pod 생성 절차는 같은 폴더의 README.md를 본다.
set -uo pipefail

PORTAL_REPO_URL="${PORTAL_REPO_URL:-https://github.com/mas615/26.10.13_eqst_hal_for_defcon34.git}"
AGENT_REPO_URL="${AGENT_REPO_URL:-https://github.com/kotw12/eqst-ctf-agent-dashboard.git}"
PORTAL_REPO=/workspace/eqsthal
PORTAL_DATA=/workspace/eqsthal-data
# 포털 원본 repo에 없는 추가 문제(대시보드 repo의 ctf-extra/)를 root만 읽는 별도 checkout으로 받는다
EXTRA_REPO=/workspace/eqsthal-extra
PORTAL_ATTACHMENTS="$PORTAL_DATA/attachments"
AGENT_REPO=/workspace/eqst-agent
AGENT_STATE=/workspace/eqst-agent-state
AGENT_USER=agent
PORTAL_PORT=18080        # 8080은 문제 이미지 중 하나가 함께 열어 충돌한다
PORTAL_LOCAL_PORT=18081  # 에이전트용 로컬 포털
PORTAL_ADMIN_IPS=192.0.2.1   # 문서용 주소(TEST-NET-1)라 어떤 접속도 관리자가 되지 않는다
DASHBOARD_PORT=4173
export UDOCKER_DIR=/opt/udocker-data
UD=/opt/udocker-venv/bin/udocker
CHAL_LOG_DIR=/var/log/challenges

# id|image|내부 포트 — 단일 프로세스이면서 포트가 겹치지 않는 문제만 고른 경량 목록
CHALLENGES=(
  "orange|llmctf/2017q-web-orange:latest|9999"
  "algebra|llmctf/2018q-misc-algebra:latest|4324"
  "bigboi|llmctf/2018q-pwn-bigboi:latest|1436"
  "baby_crypt|llmctf/2017q-rev-baby_crypt:latest|8000"
  "grumpcheck|llmctf/2017q-rev-grumpcheck:latest|7890"
  "guess_harder|llmctf/2013q-web-guessharder:latest|80"
  "silkgoat|llmctf/2014q-web-silkgoat:latest|5000"
  "k_stairs|llmctf/2015q-web-kstairs:latest|4567"
  "throwback|llmctf/2015q-web-throwback:latest|4000"
  "seizure_cipher|llmctf/2016f-web-seizurecipher:latest|9000"
)

log() { echo "[allinone] $*"; }
as_agent() {
  runuser -u "$AGENT_USER" -- env HOME="/home/$AGENT_USER" PATH="$PATH" \
    EQST_STATE_DIR="$AGENT_STATE" CTF_CODEX_HOME="$AGENT_STATE/codex" "$@"
}

install_base() {
  log "installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null 2>&1
  apt-get install -y -qq git curl ca-certificates python3 python3-venv openssh-server iproute2 >/dev/null 2>&1

  if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)' 2>/dev/null; then
    log "installing Node.js 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource.sh && bash /tmp/nodesource.sh >/dev/null 2>&1
    apt-get install -y -qq nodejs >/dev/null 2>&1
  fi
  command -v codex >/dev/null 2>&1 || npm i -g @openai/codex >/dev/null 2>&1
  log "node $(node -v), $(codex --version 2>&1)"

  if [ ! -x "$UD" ]; then
    python3 -m venv /opt/udocker-venv >/dev/null 2>&1
    /opt/udocker-venv/bin/pip install -q udocker >/dev/null 2>&1
    "$UD" --allow-root install >/dev/null 2>&1
  fi
  log "udocker $("$UD" --allow-root version 2>&1 | head -1)"

  # repo 소유자를 agent로 바꾼 뒤에도 root가 git을 읽을 수 있게 한다
  git config --global --add safe.directory '*'
  id "$AGENT_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$AGENT_USER"
  mkdir -p "$UDOCKER_DIR" "$CHAL_LOG_DIR"
  chmod 700 "$UDOCKER_DIR" "$CHAL_LOG_DIR" /opt/udocker-venv
}

start_ssh() {
  # runpod/base의 /start.sh는 nginx도 띄워 문제 포트와 겹칠 수 있어, SSH만 따로 켠다
  [ -n "${PUBLIC_KEY:-}" ] || return 0
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  echo "$PUBLIC_KEY" >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
  ssh-keygen -A >/dev/null 2>&1
  service ssh start >/dev/null 2>&1 && log "sshd started"
}

sync_repo() {  # url, dir
  if [ ! -d "$2/.git" ]; then
    git clone -q "$1" "$2" || return 1
  else
    git -C "$2" pull -q --ff-only || log "git pull failed for $2; keeping the current checkout"
  fi
}

run_challenge() {  # id, image, port — 컨테이너가 죽으면 다시 띄운다
  local id="$1" image="$2" port="$3"
  while true; do
    "$UD" --allow-root run "$id" >>"$CHAL_LOG_DIR/$id.log" 2>&1
    echo "[$(date -u +%FT%TZ)] $id exited ($?); restarting in 5s" >>"$CHAL_LOG_DIR/$id.log"
    sleep 5
  done
}

start_challenges() {
  for entry in "${CHALLENGES[@]}"; do
    IFS='|' read -r id image port <<<"$entry"
    "$UD" --allow-root inspect "$image" >/dev/null 2>&1 || "$UD" --allow-root pull "$image" >/dev/null 2>&1 \
      || { log "pull failed: $image"; continue; }
    # 문제 상태가 남지 않도록 기동할 때마다 이미지에서 새 컨테이너를 만든다
    "$UD" --allow-root rm -f "$id" >/dev/null 2>&1
    "$UD" --allow-root create --name="$id" "$image" >/dev/null 2>&1
    case "$id" in
      orange) cp "$PORTAL_REPO/deployments/orange/server.js" "$UDOCKER_DIR/containers/$id/ROOT/data/server.js" ;;
    esac
    run_challenge "$id" "$image" "$port" &
    log "challenge $id started (127.0.0.1:$port)"
  done
}

wait_port() {  # port, seconds
  for _ in $(seq 1 "$2"); do
    timeout 2 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

write_portal_config() {
  # RunPod은 공개한 TCP 포트마다 RUNPOD_TCP_PORT_<내부 포트>와 RUNPOD_PUBLIC_IP를 넣어 준다.
  # 공개 포털에는 사람이 접속할 공인 주소를, 로컬 포털에는 에이전트가 접속할 127.0.0.1 주소를 싣는다.
  local public_targets="{" local_targets="{" listing="" sep=""
  for entry in "${CHALLENGES[@]}"; do
    IFS='|' read -r id image port <<<"$entry"
    local ext_var="RUNPOD_TCP_PORT_${port}"
    local address="127.0.0.1:$port"
    if [ -n "${RUNPOD_PUBLIC_IP:-}" ] && [ -n "${!ext_var:-}" ]; then
      address="${RUNPOD_PUBLIC_IP}:${!ext_var}"
    fi
    if wait_port "$port" 60; then
      public_targets+="${sep}\"$id\": \"$address\""
      local_targets+="${sep}\"$id\": \"127.0.0.1:$port\""
      sep=", "
      listing+="$id 127.0.0.1:$port public=$address"$'\n'
    else
      log "challenge $id did not open port $port; leaving it out"
    fi
  done
  public_targets+="}"
  local_targets+="}"
  printf '%s' "$listing" > /workspace/challenge-targets.txt
  chmod 644 /workspace/challenge-targets.txt

  PUBLIC_TARGETS="$public_targets" LOCAL_TARGETS="$local_targets" python3 - "$PORTAL_REPO/challenges.json" \
    "$PORTAL_DATA/challenges.json" "$PORTAL_DATA/challenges-local.json" "$EXTRA_REPO/ctf-extra/challenges.json" <<'PY'
import copy
import json
import os
import sys
from urllib.parse import urlparse

source, public_output, local_output, extra = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
original_payload = json.load(open(source, encoding="utf-8"))
# 추가 문제는 첨부형만 받고, 원본과 id가 겹치면 원본을 남긴다
if os.path.exists(extra):
    known = {c["id"] for c in original_payload["challenges"]}
    for challenge in json.load(open(extra, encoding="utf-8"))["challenges"]:
        if challenge["id"] in known or challenge.get("protocol") != "file":
            print(f"[allinone] extra challenge skipped: {challenge['id']}")
            continue
        original_payload["challenges"].append(challenge)
        known.add(challenge["id"])
# 배포된 자료의 flag가 자리표시자뿐이고 실행 서비스도 없어 풀 수 없는 첨부형 문제
UNSOLVABLE = {"shark_facts", "snail_race_1"}


def render(targets: dict, output: str) -> list:
    payload = copy.deepcopy(original_payload)
    kept = []
    for challenge in payload["challenges"]:
        if challenge["id"] in UNSOLVABLE:
            continue
        if challenge["protocol"] == "file":
            kept.append(challenge)
            continue
        address = targets.get(challenge["id"])
        if not address:
            # 경량 배포에서 띄우지 않은 문제는 포털에서 아예 뺀다(목록·API·첨부파일 모두)
            continue
        kept.append(challenge)
        if challenge["protocol"] in ("http", "https"):
            original = urlparse(challenge.get("target") or "")
            suffix = original.path + (f"?{original.query}" if original.query else "")
            challenge["target"] = f"{challenge['protocol']}://{address}{suffix}"
        else:
            challenge["target"] = address
        # port를 비워야 포털이 PUBLIC_HOST:port로 주소를 다시 쓰지 않는다
        challenge["port"] = None
    payload["challenges"] = kept
    json.dump(payload, open(output, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return [c["id"] for c in kept]


visible = render(json.loads(os.environ["PUBLIC_TARGETS"]), public_output)
render(json.loads(os.environ["LOCAL_TARGETS"]), local_output)
print(f"[allinone] {len(visible)} challenges visible: {', '.join(visible)}")
PY
}

run_portal() {  # name, listen host, listen port, challenges file
  (
    export DATA_DIR="$PORTAL_DATA" CHALLENGES_FILE="$4"
    export ATTACHMENTS_ROOT="$PORTAL_ATTACHMENTS" LISTEN_HOST="$2" LISTEN_PORT="$3"
    export PUBLIC_HOST="${RUNPOD_POD_ID:-localhost}-${PORTAL_PORT}.proxy.runpod.net"
    export ADMIN_IPS="$PORTAL_ADMIN_IPS" RATE_LIMIT_ATTEMPTS=360
    while true; do
      python3 "$PORTAL_REPO/portal/app.py"
      log "$1 portal exited ($?); restarting in 5s"
      sleep 5
    done
  ) &
}

start_portal() {
  run_portal public 0.0.0.0 "$PORTAL_PORT" "$PORTAL_DATA/challenges.json"
  run_portal local 127.0.0.1 "$PORTAL_LOCAL_PORT" "$PORTAL_DATA/challenges-local.json"
}

start_agent() {
  # 이전 기동에서 남은 로컬 변경(예전 패치 등)을 되돌려야 git pull이 막히지 않는다
  [ -d "$AGENT_REPO/.git" ] && git -C "$AGENT_REPO" checkout -q -- .
  sync_repo "$AGENT_REPO_URL" "$AGENT_REPO" || { log "agent clone failed"; return 1; }
  # 예전 checkout(seal.mjs 100644)에서도 deploy/start.sh의 -x 검사를 통과하게 권한을 맞춘다.
  git -C "$AGENT_REPO" config core.fileMode false
  chmod 755 "$AGENT_REPO/seal/bin/seal.mjs"
  mkdir -p "$AGENT_STATE"
  chown -R "$AGENT_USER:$AGENT_USER" "$AGENT_REPO" "$AGENT_STATE"

  # 커밋이 바뀌었을 때만 deploy/install.sh(npm ci + build)를 다시 돌린다
  local build_id
  build_id="$(git -C "$AGENT_REPO" rev-parse HEAD)"
  if [ "$(cat "$AGENT_STATE/.installed-commit-$AGENT_USER" 2>/dev/null)" != "$build_id" ]; then
    log "running deploy/install.sh as $AGENT_USER for $build_id"
    as_agent bash -c "cd '$AGENT_REPO' && git config --global --add safe.directory '$AGENT_REPO' && bash deploy/install.sh" \
      || { log "agent install failed"; return 1; }
    echo "$build_id" > "$AGENT_STATE/.installed-commit-$AGENT_USER"
  fi

  # 대시보드 설정은 기동할 때마다 새로 쓴다. 계정은 DASHBOARD_USERS("id:pw,id2:pw2")를 쓰고,
  # 없으면 이전에 쓴 계정을, 그것도 없으면 무작위 비밀번호의 eqst 계정을 만든다.
  local env_file="$AGENT_STATE/dashboard.env"
  local users="${DASHBOARD_USERS:-}"
  [ -n "$users" ] || users="$(sed -n "s/^AUTH_USERS='\(.*\)'$/\1/p" "$env_file" 2>/dev/null)"
  if [ -z "$users" ]; then
    users="eqst:$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | cut -c1-24)"
    log "DASHBOARD account created: $users"
  fi
  local first="${users%%,*}"
  (
    umask 077
    cat > "$env_file" <<EOF
PUBLIC_ORIGIN=https://${RUNPOD_POD_ID}-${DASHBOARD_PORT}.proxy.runpod.net
AUTH_USER='${first%%:*}'
AUTH_PASSWORD='${first#*:}'
AUTH_USERS='${users}'
# RunPod 프록시를 거친 요청의 Host가 허용 목록과 맞지 않아 403이 나므로 Host 검사만 푼다
ALLOWED_HOSTS='*'
DEMO_CTF_URL=http://127.0.0.1:${PORTAL_LOCAL_PORT}
PORTAL_PUBLIC_HOST=${RUNPOD_POD_ID}-${PORTAL_PORT}.proxy.runpod.net
EOF
  )
  chown "$AGENT_USER:$AGENT_USER" "$env_file"
  log "dashboard accounts: $(printf '%s' "$users" | tr ',' '\n' | cut -d: -f1 | paste -sd, -)"

  until as_agent node "$AGENT_REPO/seal/bin/seal.mjs" login status >/dev/null 2>&1; do
    log "Codex login required: open the link below and enter the code"
    as_agent env CODEX_HOME="$AGENT_STATE/codex" codex login --device-auth
    sleep 3
  done
  log "Codex login OK"

  log "starting dashboard on 0.0.0.0:$DASHBOARD_PORT as $AGENT_USER"
  while true; do
    as_agent bash "$AGENT_REPO/deploy/start.sh"
    log "dashboard exited ($?); restarting in 5s"
    sleep 5
  done
}

# PORTAL_RESET 값이 지난번과 다르면 포털 기록(제출·리더보드 DB)을 한 번 초기화한다.
# 기존 DB는 지우지 않고 $PORTAL_DATA/archive/로 옮겨 둔다.
reset_portal_db() {
  local marker="$PORTAL_DATA/.reset-id"
  [ -n "${PORTAL_RESET:-}" ] || return 0
  [ "$(cat "$marker" 2>/dev/null)" = "$PORTAL_RESET" ] && return 0
  local archive="$PORTAL_DATA/archive/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$archive"
  for f in "$PORTAL_DATA"/halctf.sqlite3*; do
    [ -e "$f" ] && mv "$f" "$archive/"
  done
  echo "$PORTAL_RESET" > "$marker"
  log "portal records reset ($PORTAL_RESET); previous DB moved to $archive"
}

main() {
  if [ -z "${RUNPOD_POD_ID:-}" ]; then log "RUNPOD_POD_ID is not set"; fi
  install_base
  start_ssh

  sync_repo "$PORTAL_REPO_URL" "$PORTAL_REPO" || { log "portal clone failed"; return 1; }
  mkdir -p "$PORTAL_DATA"
  chmod 700 "$PORTAL_REPO" "$PORTAL_DATA"
  reset_portal_db
  sync_repo "$AGENT_REPO_URL" "$EXTRA_REPO" || log "extra challenge clone failed; serving the original set only"
  [ -d "$EXTRA_REPO" ] && chmod 700 "$EXTRA_REPO"
  # 포털 첨부파일은 원본과 추가 문제를 합친 사본에서 내보낸다
  rm -rf "$PORTAL_ATTACHMENTS"
  cp -a "$PORTAL_REPO/attachments" "$PORTAL_ATTACHMENTS"
  [ -d "$EXTRA_REPO/ctf-extra/attachments" ] && cp -a "$EXTRA_REPO/ctf-extra/attachments/." "$PORTAL_ATTACHMENTS/"

  start_challenges
  write_portal_config
  log "listening ports: $(ss -ltnpH 2>/dev/null | awk '{split($4,a,":"); p=a[length(a)]; match($0,/"[^"]+"/); printf "%s(%s) ", p, substr($0,RSTART+1,RLENGTH-2)}')"
  start_portal
  log "portals: public 0.0.0.0:$PORTAL_PORT, agent 127.0.0.1:$PORTAL_LOCAL_PORT (admin disabled)"

  # Pod 안에서는 자기 공인 IP로 되돌아오는 연결이 막혀 있어(hairpin 불가), 에이전트는 127.0.0.1 주소를 써야 한다.
  # 그 목록을 에이전트가 읽을 수 있는 곳에 남긴다.
  install -o "$AGENT_USER" -g "$AGENT_USER" -m 644 /workspace/challenge-targets.txt "/home/$AGENT_USER/challenge-targets.txt"

  start_agent
}

main 2>&1 &
wait
# 설치가 실패해도 컨테이너를 살려 두어 로그와 상태를 확인할 수 있게 한다
sleep infinity
