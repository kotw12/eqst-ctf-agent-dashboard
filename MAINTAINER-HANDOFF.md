# EQST CTF Agent — 운영·유지보수 인수인계

이 문서는 **공개 배포물의 구조와 운영 절차**를 다음 유지보수 담당자에게 전달한다. 비밀번호·토큰·대회 계정·Pod ID는 여기에 적지 않는다. 실제 RunPod 인스턴스 접속, EQSTHAL 서버 설치, BSK 브라우저 연동은 아직 이 배포물에서 검증되지 않았다. 배포 전제와 최초 설치 명령은 [README.md](README.md)가 기준이다.

## 1. 소유권과 실행 구조

- 공개 배포 저장소: `https://github.com/kotw12/eqst-ctf-agent-dashboard`, 기본 브랜치 `main`. Pod에는 이 저장소를 `/workspace/eqst-agent`로 clone한다. **Pod에서 운영하는 코드는 이 저장소가 기준**이다.
- 원본 개발 경로는 별개다: `eqsthal-pr/seal-live`(대시보드), `ctf-harness`(SEAL 프로필). `seal-live/deploy/pack.mjs`가 두 소스를 allowlist로 합쳐 새 배포 폴더를 만든다. 공개 저장소에서 수정한 내용은 원본에 자동 반영되지 않는다. 새 export로 덮어쓰기 전 차이를 비교하고 의도적으로 양쪽을 동기화한다.
- React/Vite UI → Express API/SSE → `Runner`의 SEAL 프로세스 한 개 → native Codex CLI 순서다. 모델 호출·OAuth·대화 저장은 Codex가 담당한다. 대시보드는 실행·시각화·기록·사용자 개입을 담당하며 CTF 플랫폼이나 모델 서버가 아니다.
- 한 번에 활성 실행 **하나**. 실행마다 Run ID, native thread, 별도 작업폴더를 쓴다. 중단 후 이어하기는 같은 thread와 폴더를 재사용한다. 서버 재시작 시 실행 중 턴은 `interrupted`로 복원하고 **자동 재실행하지 않는다**.
- 초기 패키지에는 분석 도구 대량 설치, BSK CLI·브라우저 확장·Chromium, EQSTHAL 대회 서버, 과거 실행 자료가 없다. 새 실행 설정의 브라우저 연결 기본값은 배포 빌드에서 꺼져 있다. 브라우저 없는 정적 HTTP/API 작업만 가능한 범위를 먼저 확인한다.

| 위치 | 유지보수 책임 |
|---|---|
| `dashboard/src/App.tsx`, `styles.css` | 화면, 운영자 조작, 실행 표시. UI 변경 후 실제 브라우저 화면 확인 |
| `dashboard/shared/protocol.ts` | 실행 설정·이벤트 Zod 계약 및 뷰 상태. 서버와 UI를 함께 갱신 |
| `dashboard/server/index.ts` | 포트/Host/Origin, 로그인·API·SSE·정적 파일 라우팅 |
| `dashboard/server/auth.ts` | 운영자 ID/PW, 세션 쿠키, 로그인 제한 |
| `dashboard/server/runner.ts`, `normalize.ts`, `report.mjs` | Codex 실행·재개·JSONL 정규화·공개 진행 이벤트 |
| `dashboard/server/store.ts` | 영속 실행 기록, 재시작 복원, 파일 접근 범위 |
| `dashboard/server/browser.ts`, `bsk` | **선택 기능**인 Agent Window 캡처와 BSK 명령 직렬화 |
| `seal/bin`, `seal/codex`, `seal/core`, `seal/skills` | Codex 프로필·스킬·도구 카탈로그. 전체 `ctf-harness`가 아니라 경량 export |
| `deploy/install.sh`, `deploy/start.sh` | 설치/빌드/프로필 준비, 공개용 필수 설정·기동 |

## 2. RunPod와 영속 상태

Ubuntu x86-64 CPU Pod의 같은 OS 사용자로 Node.js **22.19+**, npm, Git, native `codex`를 준비한다. `/workspace` 영속 볼륨을 사용하고 HTTP **4173**을 RunPod 프록시로 공개한다. 외부 주소는 `https://<POD_ID>-4173.proxy.runpod.net`; Node는 Pod 내부 `0.0.0.0:4173`에서 수신한다. TLS는 프록시에서 종료된다. Compose/systemd가 Pod 안에 있다고 가정하지 말고, Pod 시작 명령을 `bash /workspace/eqst-agent/deploy/start.sh`로 설정한다. Node/Codex를 컨테이너 임시 디스크에 수동 설치했다면 Pod 재생성 시 다시 필요하다.

| 영속 경로 (`EQST_STATE_DIR` 기본값 `/workspace/eqst-agent-state`) | 내용·주의 |
|---|---|
| `dashboard.env` | `PUBLIC_ORIGIN`, `AUTH_USER`, `AUTH_PASSWORD`; OS 사용자만 읽도록 mode `0600`. **Git 금지** |
| `codex/` | 분리된 Codex 설정, OAuth 캐시·대화·스킬. 인증 파일은 비밀번호와 동급. **Git/로그/이슈 금지** |
| `runs/<uuid>/` | `meta.json`, `events.jsonl`, `native.jsonl`, 선택적 `frame.webp`. `native.jsonl`은 실행당 32 MiB 한계 |
| `workspaces/eqst-session-<uuid>/` | 해당 실행의 문제 파일·노트·`.live-signals.jsonl`; 다른 실행과 섞지 않음 |

기본값을 바꾸면 `EQST_STATE_DIR`, `CTF_CODEX_HOME`, `EQST_DATA_DIR`, `EQST_WORKSPACE_ROOT`를 **설치·로그인·시작에서 일치**시킨다. `meta.json`에는 절대 작업폴더 경로가 저장된다. 기존 기록을 다른 마운트 경로로 이동할 때는 단순 폴더 복사로 이어하기가 보장되지 않는다. 10GB는 시작 용량일 뿐 상한 보증이 아니다. `df -h /workspace`와 `du -sh /workspace/eqst-agent*`를 주기적으로 확인하고, 볼륨 삭제/Pod 종료 전 별도 비공개 백업을 준비한다. 볼륨 종류에 따라 Pod 삭제 후 보존 여부가 다르다.

## 3. 인증·접속정보 변경

**대시보드 운영자 인증과 Codex OAuth, 대회 계정은 서로 다르다.**

1. 대시보드 계정 변경: `/workspace/eqst-agent-state/dashboard.env`의 `AUTH_USER`, `AUTH_PASSWORD`를 운영자가 안전하게 교체하고 mode `0600`을 유지한 뒤 서비스를 재시작한다. `deploy/start.sh`는 공개 URL과 비기본 비밀번호를 요구하고 `AUTH_SECURE_COOKIE=1`을 설정한다. `PUBLIC_ORIGIN`은 실제 HTTPS 프록시의 origin(경로 없음)과 정확히 맞춰야 한다. Pod ID/공개 포트가 바뀌면 함께 수정한다.
2. 로그인 로직 변경: `dashboard/server/auth.ts`와 `index.ts`를 함께 검토한다. 현재 세션은 **프로세스 메모리**에만 저장되므로 재시작·비밀번호 교체 시 모두 재로그인한다. 쿠키는 12시간, `HttpOnly`, `SameSite=Strict`, 공개 런처에서는 `Secure`다. 로그인 실패 5회/60초 제한은 소켓 원격 주소 기준이라 프록시 뒤 여러 사용자가 한 주소로 보일 수 있다. `index.ts`는 Host·Origin을 검사하며 인증된 API 변경 요청에는 부트스트랩의 `x-seal-live` 토큰도 요구한다. 이를 우회하는 임시 공개 엔드포인트를 만들지 않는다.
3. Codex 로그인/교체: 같은 OS 사용자에서 `CODEX_HOME=/workspace/eqst-agent-state/codex codex login` 또는 프로필의 `seal login`을 쓴다. 일반 `~/.codex`의 로그인은 분리된 SEAL 홈에 자동 적용되지 않는다. 시작 시 `seal login status`는 저장된 로그인 상태만 확인한다. **토큰 유효성·모델 권한의 증명은 아니므로** 실제 짧은 모델 호출에서 `token_expired`/401이 나면 같은 홈으로 재로그인한다. `CODEX_HOME`을 서비스 셸에 전역으로 두지 말고 `CTF_CODEX_HOME`을 사용한다.
4. 대회 사이트의 ID/PW·쿠키·제출 권한은 별도 운영 대상이다. 공개 저장소·실행 로그·스크린샷에 노출될 수 있으므로 최소 권한 계정과 별도 보관 경로를 사용한다. 운영자 로그인만으로 대회 제출 권한을 확대했다고 간주하지 않는다.

현재 인증은 단일 운영자 프로토타입이다. MFA/RBAC나 사용자별 격리 서비스가 아니다. `npm start`를 직접 공개하면 `auth.ts`의 `eqst/eqst` 개발 기본값이 적용될 수 있으므로 **공개 기동은 `deploy/start.sh`만 사용**하고, 비밀번호·Origin 누락을 오류로 처리한다. 실행 로그 다운로드·파일 미리보기·브라우저 프레임은 인증 뒤에도 민감 정보를 담을 수 있다.

## 4. 수정·배포·복구

- 대시보드 수정은 Git 작업 브랜치에서 수행한다. UI와 API 계약을 같이 변경하고, 비밀값이나 `/workspace/eqst-agent-state`는 commit하지 않는다. 현재 **공개 export에는 기존 `server/*.test.ts`가 포함되지 않는다**. 따라서 공개 checkout에서 `npm test`를 실행해 회귀 검증을 했다고 주장하면 안 된다. 원본 `seal-live`의 테스트를 가져오거나 수정 경로에 맞는 테스트를 추가해야 한다.
- 빌드 검증: `npm --prefix dashboard ci --no-audit --no-fund` → `VITE_DEFAULT_BROWSER=0 npm --prefix dashboard run build` → `npm --prefix dashboard prune --omit=dev --no-audit --no-fund`. 설치 스크립트가 이 순서를 수행한다. 변경된 UI는 실제 브라우저에서, API는 허용 Origin과 거부 Origin 모두에서 확인한다.
- 배포 전 알려진 정상 Git SHA를 기록하고 영속 상태를 비공개 백업한다. 활성 에이전트가 있으면 운영자와 조율해 안전하게 턴을 마친 뒤 코드를 갱신한다. `git pull --ff-only`로 공개 저장소를 갱신하고 `bash deploy/install.sh`로 재빌드한 뒤 Pod 시작 명령을 재시작한다. 새 로그인 세션이 필요하다.
- 실패 시 이전 Git SHA의 코드로 되돌려 다시 설치·기동한다. **상태 볼륨은 삭제하거나 이전 코드 위에 덮어쓰지 않는다.** 데이터 형식이 달라졌다면 그 버전의 백업과 함께 복구를 설계한다. SEAL·native Codex 업데이트도 버전 호환 및 `resume` 경로를 작은 실행으로 먼저 확인한다.

## 5. 도구·브라우저 확장 시

필요한 도구만 증거가 생겼을 때 설치한다. `node seal/bin/seal.mjs tools list --brief --json`은 **발견**만 하며, `node seal/bin/seal.mjs tools check <capability-id> --no-save --json`은 제한된 readiness probe다. `available`은 문제 풀이 성공을 뜻하지 않는다. 설치 후 실행 경로·버전·짧은 무해한 probe·실제 작은 입력에서의 결과를 구분해서 기록한다. `SEAL_ANALYSIS_PYTHON`은 전용 Python interpreter의 **절대경로** override이고, `SEAL_TOOL_INSTALL_MANIFEST`는 검증된 private-prefix 도구의 설치 기록이다. WSL에서 가져온 바이너리/venv/manifest를 Ubuntu에 복사해 준비 완료로 표시하지 않는다. Sage 등 Docker-backed 도구는 Pod 내부 Docker 접근이 실제 가능한지 확인하기 전에는 설치 대상으로 가정하지 않는다.

브라우저 연결을 켜려면 BSK CLI **뿐 아니라** Pod 내부 Chromium/확장/데몬 연결과 `browser-skill`이 필요하다. `dashboard/server/browser.ts`는 전용 Agent Window와 캡처를 기대한다. 연결 실패를 숨기거나 브라우저 없는 HTTP 접근을 DOM 검증과 동일하다고 표시하지 않는다. EQSTHAL 대회 서버는 사용자가 별도 Git/접속 정보를 주면 그때 별도 배포·네트워크·계정 계획을 세운다.

## 6. 빠른 진단 기준

| 증상 | 먼저 확인할 사실 |
|---|---|
| 외부 URL이 열리지 않음 | Pod 가동, 4173 HTTP 포트 공개, `PUBLIC_ORIGIN`, 서버 시작 로그, DNS/프록시 주소 |
| 로그인 401/429 또는 POST 403 | 운영자 자격·시도 제한, 정확한 HTTPS Origin/Host, `Secure` 쿠키, 인증 후 `x-seal-live` 토큰. 토큰/비밀번호는 출력하지 않음 |
| `/api/health`에 버전만 있고 실행 실패 | `CTF_CODEX_HOME`의 로그인 상태와 실행 카드 stderr, 실제 모델 접근권한. health는 인증/모델 호출 검사가 아님 |
| 브라우저 `unavailable` | 이 경량 패키지의 기본 상태. 브라우저 모드 선택 여부와 BSK/확장 연결을 별개 확인 |
| 도구 `missing`/`stale` | 해당 capability만 목록·probe, 선택 Python/manifest의 절대경로·권한·실행 파일 변경 여부 |
| 재시작 후 실행 `interrupted` | 의도된 복원 동작. 동일 작업폴더·thread가 존재하는지 확인 후 대시보드에서 이어하기 |
| 로그가 멈춤/용량 부족 | `runs/<id>/native.jsonl` 32 MiB 제한, `/workspace` 여유 용량, SSE 15초 heartbeat·재연결. 기록을 지우기 전 비공개 백업 |

**인계 확인:** 공개 HTTPS에서 운영자 로그인 → `/api/health` 버전 → 허가된 무해한 URL로 새 실행(브라우저 끔) → 실제 모델 응답과 도구 결과 → 작업폴더·이벤트 저장 → 서비스 재시작 뒤 기록 복원. 이 절차가 통과하기 전에는 RunPod 실제 운용이나 EQSTHAL 연동이 검증됐다고 보고하지 않는다.
