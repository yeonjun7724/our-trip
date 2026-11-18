# 데이터 출처

| 데이터 | 출처 | 상태 표시 | 저장 |
|---|---|---|---|
| 여행·멤버·장소·투표·일정·열차 기록 | 사용자 입력 | USER_ENTERED | PostgreSQL에 영구 저장 |
| 장소 좌표 | 사용자가 지도에서 선택 / OSM Nominatim | USER_ENTERED / VERIFIED_STATIC | `coordinate_source`, `osm_ref` |
| 초기 후보 15곳 좌표 | OSM Nominatim (`scripts/geocode_candidates.py`, 2026-11-18) | VERIFIED_STATIC | `data/seed/candidates.json`. 13곳 확인. **전포 카페거리와 구룡포는 찾지 못해 좌표 없음** |
| 보행 네트워크 | Geofabrik `south-korea-latest.osm.pbf` (OSM 데이터 시각 2026-11-17T21:24:30Z) → OSMnx | ESTIMATED (OSMnx 계산) | `data/graphs/*.graphml`, 이미지에 포함 |
| OSM 정류장·역 | 위와 같은 추출본 (`highway=bus_stop`, `railway=station/halt`) | VERIFIED_STATIC | `data/graphs/*_stops.geojson` |
| 열차 역 목록 | TAGO 열차정보 (시·도별 기차역) | VERIFIED_STATIC | `rail_stations` (7일마다 갱신) |
| 열차 시간표 | TAGO 출·도착지 기반 열차정보 | SCHEDULED | 저장하지 않음. 사용자가 고른 열차만 `rail_reservations`에 `TAGO_TIMETABLE`과 조회 시각으로 저장 |
| 버스정류장 / 경유 노선 | TAGO 버스정류소정보 | VERIFIED_STATIC | 메모리 1시간 |
| 버스 도착예정 | TAGO 버스도착정보 | LIVE (2분이 지나면 STALE) | 메모리 20초 |
| 대중교통 경로 | ODsay searchPubTransPathT / loadLane | SCHEDULED (조회 시점 기준) | 저장하지 않음. 사용자가 고른 요약만 `transport_legs`에 저장 |
| 지도 타일 | OpenFreeMap (OpenMapTiles, OSM) | – | – |

출처 표기: © OpenStreetMap contributors (ODbL 1.0) · OpenFreeMap · OpenMapTiles · powered by www.ODsay.com · 국토교통부 TAGO(공공데이터포털)

## 도시별 TAGO 지원 여부

키가 없어 **아직 확인하지 못했습니다.** 앱은 각 서비스의 `getCtyCodeList`를 런타임에 조회해 판단합니다.
부산·경주·포항이 같은 방식으로 지원된다고 가정하지 않습니다. 확인 방법은 다음 두 가지입니다.
- `GET /api/transit/regions` (로그인 필요)
- `uv run python scripts/check_providers.py`

목록에 없는 도시의 정류장은 실시간 도착정보를 "이 지역은 제공하지 않아요"로 표시합니다.
