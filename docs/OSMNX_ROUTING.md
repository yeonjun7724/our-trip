# OSMnx 도보 경로

## 그래프 생성 (개발 환경에서 1회)

```bash
curl -L -o .osm_extract/south-korea-latest.osm.pbf https://download.geofabrik.de/asia/south-korea-latest.osm.pbf
cd apps/api && uv run python ../../scripts/build_walk_graphs.py --pbf ../../.osm_extract/south-korea-latest.osm.pbf
# 또는 Overpass가 원활할 때: ... build_walk_graphs.py --overpass
```

2026-11-18 빌드 중 공용 Overpass 서버 3곳 모두 과부하(504, timeout)가 반복돼 **Geofabrik 추출본 경로**를 사용했습니다.
way는 OSMnx 2.x `network_type="walk"` 필터와 같은 조건으로 고릅니다. highway 값 중 abandoned|bus_guideway|construction|
cycleway|motor|no|planned|platform|proposed|raceway|razed와, area=yes, access=private, foot=no, service=private를 제외합니다.
남은 way를 권역별 OSM XML로 쓴 뒤 `osmnx.graph_from_xml(bidirectional=True, simplify=True)`로 그래프를 만들고,
bbox로 자른 다음 가장 큰 연결 요소만 남깁니다.

| 권역 | 노드 | 엣지 | OSM 정류장 |
|---|---|---|---|
| busan_haeundae (해운대·광안리) | 7,567 | 20,610 | 233 |
| busan_central (부산역·남포·영도·감천) | 6,697 | 19,206 | 134 |
| busan_seomyeon (서면·전포) | 2,951 | 8,398 | 85 |
| gyeongju_downtown | 3,877 | 11,178 | 180 |
| gyeongju_station (KTX 경주역) | 181 | 498 | 21 |
| pohang_downtown (영일대·죽도·포항역) | 8,919 | 25,450 | 433 |
| pohang_guryongpo | 727 | 1,980 | 29 |
| pohang_homigot | 356 | 954 | 19 |

OSM 데이터 시각은 2026-11-17T21:24:30Z입니다. 범위, 생성 시각, 출처, 라이선스는 `data/graphs/manifest.json`에 기록됩니다.

## 경로 계산 (`app/routing/osmnx_engine.py`)

1. 두 좌표를 모두 포함하는 권역을 고릅니다. 없으면 `OUT_OF_GRAPH`입니다.
2. 각 좌표를 가장 가까운 노드에 스냅합니다(haversine). 80m가 넘으면 경고를, 300m가 넘으면 `SNAP_TOO_FAR`를 돌려줍니다.
3. `networkx.shortest_path(weight="length")`로 최단 경로를 구합니다. 경로가 없으면 `NO_PATH`입니다.
4. 엣지의 실제 geometry를 방향에 맞춰 이어 붙이고, 원래 좌표에서 스냅 노드까지의 연결 구간을 더합니다.
5. 거리 ÷ 보행속도(기본 4km/h, 여행 설정에서 2.5~6km/h)로 시간을 구하고 GeoJSON LineString으로 돌려줍니다.

경로가 없을 때 **직선을 도보 경로처럼 그리지 않습니다** (`geometry: null`).
주변 정류장 카드는 출발점에서 Dijkstra를 한 번 돌려 실제 보행거리를 구합니다(일대다).

## 실측 확인 (실제 그래프)

| 구간 | 결과 |
|---|---|
| 광안리 → 해운대 | 4.70km · 70.5분 |
| 대릉원 → 첨성대 | 1.04km · 15.6분 |
| 첨성대 → 동궁과 월지 | 1.32km · 19.8분 |
| 황리단길 → 월정교 | 1.67km · 25.0분 |
| 영일대 → 스페이스워크 | 2.03km · 30.5분 |
| 흰여울문화마을 → 감천문화마을 | 5.73km · 85.9분 |
| 해운대 → 첨성대 | OUT_OF_GRAPH (직선 표시 없음) |

## 한계

- 권역 밖(예: 부산 시내 권역 사이, 경주역↔시내)은 도보를 계산하지 않고 대중교통 조회를 안내합니다.
- OSM에 빠진 골목이나 계단이 있으면 실제와 다를 수 있습니다. 그래서 결과는 항상 "추정 · OSMnx 계산"으로 표시합니다.
- 컨테이너는 시작할 때 8개 그래프를 백그라운드로 미리 읽습니다(합계 약 31,000노드).
