# RunPod 올인원 배포 (EQSTHAL 포털 + 문제 서버 + 대시보드)

`bootstrap.sh` 하나로 빈 Pod에 포털, 경량 문제 서버 10개, 대시보드를 모두 올린다.
코드는 기동할 때마다 GitHub에서 받으므로, 새 Pod에 필요한 것은 아래 설정뿐이다.
이 repo는 공개 repo다. 비밀번호와 LMS 계정은 여기에 적지 말고 Pod 환경변수로만 넣는다.

## 1. 네트워크 볼륨

- 데이터센터: `US-NC-1`, 크기 20GB, 이름 예: `ctf-agent-data`
- `/workspace`에 마운트된다. 처음에는 비어 있어도 된다. repo, 문제 이미지, 포털 DB, 실행 기록, Codex 로그인은 모두 첫 기동 때 새로 만든다.

## 2. Pod 설정

| 항목 | 값 |
|---|---|
| Cloud | Secure, CPU `cpu3g` (4 vCPU / 16GB), 볼륨과 같은 데이터센터 |
| 이미지 | `runpod/base:1.0.2-ubuntu2404` |
| 컨테이너 디스크 | 40GB |
| 네트워크 볼륨 | 위 볼륨, 마운트 경로 `/workspace` |
| HTTP 포트 | `18080`(포털), `4173`(대시보드) |
| TCP 포트 | `9999, 4324, 1436, 8000, 7890, 80, 5000, 4567, 4000, 9000` (문제 서버) |
| Entrypoint | `["/bin/bash", "-lc"]` |
| 시작 명령 | `echo "$BOOTSTRAP_GZ" \| base64 -d \| gunzip > /bootstrap.sh && exec bash /bootstrap.sh` |

환경변수(5개). RunPod API의 `update-pod`는 env 전체를 바꾸므로, 고칠 때도 5개를 모두 보낸다.

| 이름 | 값 |
|---|---|
| `BOOTSTRAP_GZ` | `bootstrap.sh`를 gzip한 뒤 base64로 인코딩한 값 (아래 명령) |
| `DASHBOARD_USERS` | `id:pw,id2:pw2` 형식의 대시보드 계정. `eqst`는 관리자, 나머지는 일반 사용자 |
| `EQST_LMS_ID` / `EQST_LMS_PW` | LMS 프리셋에서 서버가 대신 로그인·제출할 계정 |
| `PORTAL_RESET` | 아무 문자열. 값을 바꾸고 재시작하면 포털 제출 기록을 한 번 초기화한다(기존 DB는 archive로 옮김) |

`BOOTSTRAP_GZ` 만들기:

```bash
gzip -9c deploy/runpod/bootstrap.sh | base64 -w0
```

```powershell
$raw = [IO.File]::ReadAllBytes("deploy\runpod\bootstrap.sh"); $ms = New-Object IO.MemoryStream
$gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress); $gz.Write($raw, 0, $raw.Length); $gz.Close()
[Convert]::ToBase64String($ms.ToArray())
```

## 3. 첫 기동

1. Pod를 만들면 패키지 설치, repo clone, 문제 이미지 pull, 대시보드 빌드가 진행된다. 볼륨이 비어 있으면 재시작 때보다 오래 걸린다.
2. Pod 로그에 `Codex login required`와 링크·코드가 나온다. 링크를 열어 코드를 넣으면 `Codex login OK` 뒤에 대시보드가 뜬다. 로그인 정보는 볼륨에 남으므로 다음 재시작부터는 다시 묻지 않는다.
3. 접속 주소
   - 대시보드: `https://<POD_ID>-4173.proxy.runpod.net`
   - 포털: `https://<POD_ID>-18080.proxy.runpod.net`

## 4. 이후 운영

- 대시보드 코드와 `ctf-extra/`의 추가 문제는 main에 병합한 뒤 Pod를 재시작하면 반영된다.
- `bootstrap.sh`를 고쳤다면 `BOOTSTRAP_GZ`를 다시 만들어 env 5개를 모두 넣고 재시작한다.
- Pod를 정지하면 컴퓨트 요금은 멈추고 볼륨 요금만 남는다. 볼륨까지 지우면 위 1~3단계로 처음부터 다시 만든다.
