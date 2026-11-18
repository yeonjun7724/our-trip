# 아키텍처

```
[휴대폰 브라우저 / PWA]
   React SPA (MapLibre 2D, TanStack Query 15초 polling + focus refetch)
        │  same-origin fetch, HttpOnly 세션 쿠키
        ▼
[Railway Web Service: FastAPI (uvicorn)]
   /api/*           비즈니스 API (Pydantic v2)
   /*               빌드된 SPA (apps/web/dist)
   ├─ services/     여행·일정·철도·링크·지오코딩 로직
   ├─ routing/      osmnx_engine (보행), transit_router (정류장·도착·경로)
   ├─ providers/    odsay · tago_train · tago_bus · tago_subway (+ base: 공통 런타임)
   └─ data/graphs   이미지에 포함된 GraphML (요청 시 Overpass 호출 없음)
        │
        ▼
[Railway PostgreSQL]  사용자 데이터 + 역 목록(정적) + 호출 로그
```

## 핵심 결정

- **서비스는 하나만** 둡니다. FastAPI가 API와 SPA를 함께 제공합니다. Redis와 WebSocket은 쓰지 않습니다. 두 사람이 쓰는
  규모라 polling과 mutation 후 invalidate로 충분합니다.
- **동시 수정**은 낙관적 잠금으로 처리합니다. `places`, `trips`, `trip_days`, `itinerary_items`, `rail_reservations`에 `version`을 두고,
  버전이 다르면 409 `VERSION_CONFLICT`와 현재 값을 돌려줍니다. 클라이언트는 최신 상태를 다시 불러와 안내합니다.
  일정 순서는 하루 단위 `base_version`으로 보호합니다.
- **공급자 추상화**: 각 어댑터는 공통 모델(`RouteOption`, `RouteLeg`, `TransportStop`, `ArrivalPrediction`, `Freshness`)로
  변환합니다. 호출 제한, 동시 요청 병합, 백오프, 상태(`ProviderRuntime`)는 `providers/base.py`가 공통으로 맡습니다.
  공급자 역할은 `provider_registry.py` 한곳에서 정의합니다.
- **시간**: 열차 시각은 `Asia/Seoul` timezone-aware datetime으로 저장합니다. 일정 타임라인은 그날 KST 자정부터의 분으로 계산합니다.
- **인증**: 여행방을 만들거나 초대 링크로 참여하면 세션 토큰을 발급합니다(32바이트, DB에는 HMAC-SHA256만 저장).
  쿠키는 HttpOnly, SameSite=Lax이고 운영 환경에서는 Secure를 붙입니다. 초대 토큰은 1회용이고 72시간 뒤 만료되며
  취소할 수 있습니다. 토큰은 URL fragment(`/join#token`)로 전달해 서버 로그와 Referer에 남지 않게 합니다.
  여행방 주인용 복구 키는 생성할 때 한 번만 보여줍니다. 다른 여행방에 접근하면 404를 돌려줘 존재 여부도 숨깁니다.
  변경 요청은 Origin 검사로 CSRF를 한 번 더 막습니다.

## 데이터 모델

`trips`, `trip_members`, `member_sessions`, `trip_invites`, `places`, `place_votes`, `trip_days`, `itinerary_items`(kind PLACE|RAIL),
`transport_legs`(사용자가 고른 구간 요약), `rail_reservations`, `rail_stations`(TAGO 역 목록), `api_usage_logs`, `activity_logs`.
마이그레이션 파일은 `apps/api/alembic/versions/0001_initial_schema.py`입니다.
