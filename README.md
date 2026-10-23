# EQST CTF Agent — 경량 RunPod 배포물

이 공개 배포물은 `seal-live/deploy/pack.mjs`로 만든 대시보드와 SEAL Codex 프로필만 포함합니다. 이전 실행·문제 파일·인증정보·CTF 분석 도구·BSK/Chromium은 포함하지 않습니다.

## 전제

- Ubuntu x86-64 CPU Pod, Node.js 22.19 이상과 npm, Git, **native Codex CLI**가 설치된 같은 OS 사용자. Codex 설치 버전은 이 배포물이 고정하지 않습니다.
- RunPod에서 **HTTP 포트 4173**을 공개합니다. 사용자 브라우저 주소는 `https://<POD_ID>-4173.proxy.runpod.net`입니다. 대시보드는 Pod 내부 `0.0.0.0:4173`에서 수신하고 TLS는 RunPod 프록시가 종료합니다.
- 영속 `/workspace` 볼륨을 사용합니다. 10GB로 시작할 수 있도록 CTF 도구·브라우저·기존 자료를 설치/복사하지 않습니다. **문제 파일·Codex 기록·로그가 쌓이면 용량은 증가**하므로 설치 직후와 테스트 중 `df -h /workspace`, `du -sh /workspace/eqst-agent*`로 측정하세요. 10GB 이내를 무조건 보장하는 용량 제한은 아닙니다.
- Pod를 재생성하면 컨테이너 디스크에 따로 설치한 Node/Codex는 사라질 수 있습니다. 재생성 후에도 즉시 기동하려면 두 실행 파일이 포함된 Pod 이미지를 사용하거나 다시 설치해야 합니다. `/workspace`의 볼륨 디스크는 Pod **재시작까지** 유지되며, Pod 삭제 시 삭제됩니다. 중요한 데이터는 별도 백업하세요.

## 설치와 로그인

RunPod의 **같은 OS 사용자**에서:

```bash
cd /workspace
git clone https://github.com/kotw12/eqst-ctf-agent-dashboard.git eqst-agent
# 일반 ~/.codex 로그인이 아닌, SEAL이 사용할 분리된 홈에 로그인합니다.
CODEX_HOME=/workspace/eqst-agent-state/codex codex login
cd /workspace/eqst-agent
bash deploy/install.sh
```

이미 `~/.codex`에만 로그인했다면 SEAL은 그 인증을 사용하지 않습니다. 로그인 시 `CODEX_HOME`을 위 경로로 지정하거나, 설치 후 `CTF_CODEX_HOME=/workspace/eqst-agent-state/codex node seal/bin/seal.mjs login`을 실행하세요. OAuth 승인·MFA는 운영자가 직접 수행합니다. 토큰 파일을 Git이나 배포물로 옮기지 않습니다.

`/workspace/eqst-agent-state/dashboard.env`를 이 OS 사용자만 읽을 수 있게 만듭니다. 다음 값은 예시이며 실제 Pod ID와 새 비밀번호를 넣으세요:

```bash
umask 077
cat > /workspace/eqst-agent-state/dashboard.env <<'EOF'
PUBLIC_ORIGIN=https://<POD_ID>-4173.proxy.runpod.net
AUTH_USER=eqst
AUTH_PASSWORD=<NEW_STRONG_PASSWORD>
EOF
chmod 600 /workspace/eqst-agent-state/dashboard.env
```

RunPod의 시작 명령으로 `bash /workspace/eqst-agent/deploy/start.sh`를 사용하거나 같은 명령을 터미널에서 실행합니다. `AUTH_PASSWORD`와 `PUBLIC_ORIGIN`은 환경변수로 직접 주입해도 됩니다. `CODEX_HOME`은 실행 셸에 전역으로 설정하지 마세요. 필요하면 `EQST_STATE_DIR`로 영속 경로를 변경할 수 있지만 설치·로그인·시작에서 **같은 경로**를 사용해야 합니다.

## 확인

1. `CTF_CODEX_HOME=/workspace/eqst-agent-state/codex node seal/bin/seal.mjs login status`로 프로필의 로그인 상태를 확인합니다. 이는 **토큰 유효성 검사가 아닙니다**. `deploy/start.sh`는 저장된 로그인 상태가 없으면 공개하지 않지만, 만료된 토큰은 실제 요청에서 401로 드러날 수 있습니다. 그때 같은 홈에서 다시 `codex login`하세요.
2. 외부 브라우저에서 위 HTTPS 주소로 로그인하고 `/api/health`가 SEAL과 Codex 버전을 반환하는지 확인합니다. 버전 응답 역시 모델 사용 가능 여부를 증명하지 않습니다.
3. 새 실행을 만들 때 **브라우저 화면 연결을 끄고**, 운영자가 접근 가능한 허가된 대상 URL을 입력해 실제 짧은 모델 호출을 수행합니다. Run 카드에서 응답·native thread·도구/진행 로그와 인증 오류 유무를 확인합니다.
4. `EQST_DATA_DIR`와 `EQST_WORKSPACE_ROOT`는 기본적으로 영속 `/workspace/eqst-agent-state/runs`, `/workspace/eqst-agent-state/workspaces`입니다. 재시작 후 기록·작업폴더가 유지되는지 확인합니다. 실행 중 재시작한 턴은 자동 재개하지 않으며 화면에서 이어하기를 선택합니다.

**브라우저 없는 범위:** SEAL은 HTTP 클라이언트(`curl` 등)로 접근 가능한 페이지/API는 사용할 수 있지만, JavaScript 렌더링·브라우저 로그인·DOM 제출·화면 캡처는 할 수 없습니다. 기존 EQSTHAL 실험은 브라우저 DOM 제출을 사용했으므로 브라우저 없는 동일 성능이나 제출을 주장하지 않습니다. BSK가 필요한 문제는 이후 별도 설치·연결해야 합니다. 아직 EQSTHAL 서버는 내려가 있으며 별도 Git/접속 정보가 제공될 예정이므로 이번 패키지는 그 서버를 배포하거나 접속하지 않습니다.

문제가 생기면 우선 `node --version`, `codex --version`, `node seal/bin/seal.mjs --version`, `node seal/bin/seal.mjs login status`, `df -h /workspace`를 확인합니다. 외부 접속 실패는 Pod의 포트 4173 공개·`PUBLIC_ORIGIN`·로그인 오류를, 에이전트 시작 실패는 실행 카드의 stderr와 해당 Codex 홈 인증을 확인합니다. `token_expired`/401이면 같은 홈으로 재로그인한 뒤 새 실행에서 실제 모델 응답을 검증합니다.
