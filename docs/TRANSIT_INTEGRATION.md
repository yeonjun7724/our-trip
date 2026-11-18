# 대중교통 연동

## 주변 정류장 — `GET /api/transit/stops/nearby?lat&lon&radius=300|500|800|1000`

- **OSM**: 그래프 빌드 때 함께 추출한 `highway=bus_stop`, `railway=station/halt`입니다. `station=subway`면 지하철로 분류합니다.
- **TAGO 버스정류소** `getCrdntPrxmtSttnList`: 공급자가 반경 500m로 고정합니다. 800m와 1km에서는 그 바깥을 OSM만으로 보여주고 화면에 안내합니다.
- **중복 제거**: 같은 유형이면서 버스는 30m, 역은 200m 안에 있고 이름이 비슷하면 카드 하나로 합칩니다.
  공급자 ID(`TAGO 21/BSB…`, `OSM node/…`)는 **나란히 보관할 뿐 서로 변환하지 않습니다.**
- 정류장마다 OSMnx로 실제 보행거리를 계산합니다. 정보가 없는 필드는 비워 둡니다(노선은 TAGO 정류장에서만 별도 조회).

## 버스 도착 — `GET /api/transit/stops/{key}/arrivals`

| 상황 | status | 문구 |
|---|---|---|
| OSM 정류장 (TAGO 매핑 없음) | UNSUPPORTED_STOP | 실시간 도착정보를 제공하지 않는 정류장입니다. |
| 키 없음 | NOT_CONFIGURED | TAGO API 키가 설정되지 않아… |
| 도착정보 서비스 도시목록에 없음 | UNSUPPORTED_REGION | 이 지역은 TAGO 버스도착정보를 제공하지 않아요. |
| 결과 없음 (resultCode 03 / 빈 목록) | EMPTY | 현재 도착정보를 확인할 수 없습니다. |
| 한도 초과 (22, HTTP 429) | QUOTA_EXCEEDED | |
| 인증 실패 (30 등, HTTP 403) | AUTH_FAILED | |
| 기타 | UPSTREAM_ERROR | 현재 도착정보를 확인할 수 없습니다. |

정상 결과는 `LIVE`로 표시하고 조회 시각을 함께 보여줍니다. 2분이 지나면 화면에서 `STALE`로 바꿉니다.
"공급자 예측값이며 도착을 보장하지 않아요" 문구를 함께 표시합니다.

## 경로 검색 — `POST /api/transit/routes` (ODsay)

- 사용하는 엔드포인트는 `searchPubTransPathT`(SX/SY/EX/EY, OPT=0)이고, 노선 모양은 버튼을 누를 때만 `loadLane`(`0:0@mapObj`)으로 가져옵니다.
- trafficType 매핑: 1 지하철, 2 버스, 3 도보, 4 열차, 5 고속버스, 6 시외버스, 7 항공.
- ODsay 도보 구간에는 좌표가 없어 앞뒤 구간의 끝점을 씁니다. 도보 모양은 **우리 OSMnx**로 계산할 수 있을 때만 그립니다.
- 노선 색은 ODsay가 주지 않으므로 공식 색을 지어내지 않고 이동수단별 일반 색을 씁니다.
- 출발시각 파라미터가 없어서, 사용자가 시각을 지정하면 "조회 시점 기준이며 해당 시각 운행을 보장하지 않아요"라고 안내합니다.
- 오류 매핑: -98 → TOO_CLOSE, -99/3/4/5 → NO_ROUTE, 6 → 지역 미지원, ApiKeyAuthFailed → 인증 실패(실제 호출로 확인), 429/limit → QUOTA_EXCEEDED, code 500 → 재시도.
- 정렬은 공급자가 돌려준 후보 안에서만 합니다(소요시간, 환승, 도보). 후보를 임의로 조합하지 않습니다.
- ODsay를 쓸 수 없으면(키 없음, 한도, 장애) 카카오맵 길찾기, Google 지도 대중교통, 네이버 지도 검색 링크를 안내합니다.
- **TMAP은 사용하지 않습니다** (2026-11-18 사용자 결정).

## 일정에 반영

일정 화면에서 구간의 "대중교통" 버튼으로 조회한 뒤 후보를 고르면 `transport_legs`에 요약이 저장되고(ESTIMATED · ODsay),
타임라인과 열차 연결 검토에 반영됩니다.
