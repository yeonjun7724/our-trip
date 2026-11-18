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

ODsay 키는 **URI 플랫폼**(`web-production-9b21ca26.up.railway.app`)으로 등록했습니다. 서버가 ODsay를 호출할 때 `Referer: PUBLIC_BASE_URL`을 보내야 인증됩니다(2026-11-18 실험으로 확인: 헤더가 없거나 Origin만 보내면 실패). 그래서 고정 IP는 필요 없습니다. 무료(Basic) 한도는 하루 30건입니다.

## 재배포

```bash
railway link --project c0ff287a-92d1-4add-9e83-86bc5fa3ee03 --environment production --service web
railway up --project c0ff287a-92d1-4add-9e83-86bc5fa3ee03 --environment production --service web --detach
railway logs --service web
```

컨테이너는 시작할 때 `alembic upgrade head`를 실행한 뒤 uvicorn을 `0.0.0.0:$PORT`에 띄웁니다(`--proxy-headers`).
헬스체크 경로는 `/api/health`(DB 연결과 그래프 수 확인)입니다. 그래프 파일은 이미지에 포함되어 재시작해도 유지되고, 시작할 때 백그라운드로 로드됩니다.

## GitHub

공개 저장소: https://github.com/yeonjun7724/our-trip (branch `main`)
