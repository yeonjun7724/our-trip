# Railway 배포

## 현재 배포 (2026-11-18)

- 프로젝트 `our-trip` (ID `c0ff287a-92d1-4add-9e83-86bc5fa3ee03`), 환경 `production`
- 서비스 `web`(Dockerfile) + `Postgres`
- URL: https://web-production-9b21ca26.up.railway.app — `/api/health` → `{"status":"ok","database":true,"walk_graph_zones":8}`
- 운영 URL에서 Playwright E2E 2개 통과: 두 사용자 협업 흐름(HTTPS Secure 쿠키 포함)과 390px 반응형

> 첫 `railway up` 때 CLI가 연결된 프로젝트 대신 **같은 이름의 `our-trip` 프로젝트를 하나 더 만들었습니다**
> (ID `3ec2ca71-77fd-40af-b6ae-1cf885e8922c`). 앱은 이 프로젝트를 쓰지 않습니다. Railway 대시보드에서 삭제해도 됩니다.

## 변수 (web 서비스)

| 변수 | 값 |
|---|---|
| `APP_ENV` | `production` (Secure 쿠키, SESSION_SECRET 필수 검사) |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (postgres:// → psycopg3 드라이버로 자동 변환) |
| `SESSION_SECRET` | 무작위 48바이트 (설정 완료) |
| `PUBLIC_BASE_URL` | `https://web-production-9b21ca26.up.railway.app` (초대 링크용) |
| `TAGO_API_KEY` | (미설정) data.go.kr 키 |
| `ODSAY_API_KEY` | (미설정) ODsay 키 |

키를 추가하는 방법:

```bash
railway variables --service web --set "TAGO_API_KEY=<data.go.kr 일반 인증키(Decoding)>"
railway variables --service web --set "ODSAY_API_KEY=<ODsay 키>"
# 변수를 바꾸면 자동으로 재배포됩니다. 확인:
curl https://web-production-9b21ca26.up.railway.app/api/providers/status
```

ODsay 서버 키는 호출 서버의 IP를 등록해야 합니다. Railway의 기본 송신 IP는 고정되어 있지 않으므로 둘 중 하나를 고릅니다.
(a) Railway Static Outbound IPs(유료 플랜 기능)를 켜고 그 IP를 ODsay 콘솔에 등록합니다.
(b) ODsay가 허용하는 다른 플랫폼 등록 방식을 씁니다.
(b)는 **검증하지 않았습니다.** 키를 넣은 뒤 상태가 `AUTH_FAILED`로 나오면 IP 등록 문제일 가능성이 큽니다.

## 재배포

```bash
railway link --project c0ff287a-92d1-4add-9e83-86bc5fa3ee03 --environment production --service web
railway up --project c0ff287a-92d1-4add-9e83-86bc5fa3ee03 --environment production --service web --detach
railway logs --service web
```

컨테이너는 시작할 때 `alembic upgrade head`를 실행한 뒤 uvicorn을 `0.0.0.0:$PORT`에 띄웁니다(`--proxy-headers`).
헬스체크 경로는 `/api/health`(DB 연결과 그래프 수 확인)입니다. 그래프 파일은 이미지에 포함되어 재시작해도 유지되고, 시작할 때 백그라운드로 로드됩니다.

## GitHub

저장소는 로컬 git으로 초기화만 했고 **커밋과 원격 저장소 생성은 하지 않았습니다.** 원하면 이렇게 올릴 수 있습니다.
`gh repo create our-trip --private --source . --push` (커밋 후 실행)
