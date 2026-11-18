# Our Trip

연인 두 명이 함께 쓰는 **부산·경주·포항 3박 4일 내일로 기차여행 (부산 2일 · 경주 1일 · 포항 1일)** 모바일 웹앱.
공동 위시리스트, 2D 지도(MapLibre), OSMnx 도보 경로, 주변 버스·지하철, ODsay 대중교통 경로,
TAGO 열차 시간표, 내일로 탑승일 계산, 철도↔현지 교통 연결 검토, 일정 최적화(승인 후 반영)를 지원합니다.

- 배포: https://web-production-9b21ca26.up.railway.app (Railway, 웹 서비스 1 + PostgreSQL 1)
- 앱 설치 없이 URL로 접속 → 바로 지도. 이름만 고르면 함께 편집 (선택: `ACCESS_CODE`로 입장 코드)
- 지도를 탭하면 그 자리에 장소 추가, 홈 화면에 추가하면 PWA로 동작

## 구조

```
apps/web    React + TypeScript + Vite + Tailwind v4 + MapLibre + TanStack Query + Zustand
apps/api    FastAPI + SQLAlchemy 2 + Alembic + psycopg3 + OSMnx 2 + httpx
data/graphs OSMnx 보행 그래프(GraphML) + OSM 정류장 레이어 (ODbL)
data/seed   초기 후보 15곳 (OSM Nominatim으로 확인된 좌표만, 미확인 2곳은 좌표 없음)
scripts     build_walk_graphs.py, geocode_candidates.py, check_providers.py
docs        아키텍처·정책·연동·배포·테스트·구현 현황
```

## 로컬 실행

```bash
# DB (예: 로컬 PostgreSQL) 준비 후
cp .env.example .env            # DATABASE_URL 등 수정
cd apps/api && uv sync && uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000

cd apps/web && npm ci && npm run dev     # http://localhost:5173 (API는 8000으로 프록시)
# 또는 npm run build 후 http://localhost:8000 에서 FastAPI가 SPA를 함께 제공
```

## 외부 API 키 (선택)

키가 없어도 여행방·초대·위시리스트·투표·지도·OSMnx 도보·OSM 정류장·일정·직접 입력 열차 기록은 모두 동작합니다.
키가 없는 기능은 "미설정"으로 표시하고 공식 외부 지도/코레일 링크를 안내합니다 (가짜 데이터 표시 없음).

| 변수 | 용도 | 발급 |
|---|---|---|
| `TAGO_API_KEY` | 열차 시간표·역 목록, 주변 버스정류장, 버스 도착정보, 지하철 | data.go.kr에서 4개 API 각각 활용신청 (같은 키) |
| `ODSAY_API_KEY` | 대중교통 경로 검색 | lab.odsay.com, 서버 플랫폼 키 + Railway 송신 IP 등록 |

TMAP은 사용하지 않습니다(프로젝트 결정).

## 테스트

```bash
cd apps/api && uv run pytest              # 46 tests (PostgreSQL 필요: TEST_DATABASE_URL)
cd apps/web && npx playwright test        # 서버 실행 후, 7 tests (두 사용자 흐름 + 6개 화면 폭)
```

자세한 내용은 [docs/](docs/)를 참고하세요.
