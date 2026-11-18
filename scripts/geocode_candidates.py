"""Look up the initial candidate places in OpenStreetMap (Nominatim) — dev-time only.

Nominatim usage policy: max 1 request/second, identifying User-Agent, no bulk use.
Results are written to data/seed/candidates.json with the OSM object id so they can be
re-verified. Entries Nominatim cannot resolve are written with null coordinates — they
are NEVER filled with guessed values. Review output manually before committing.

    cd apps/api && uv run python ../../scripts/geocode_candidates.py
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "seed" / "candidates.json"

# (city, display name, category, Nominatim query, viewbox lon1,lat1,lon2,lat2 bounding the city)
CITY_BOX = {
    "busan": "128.85,35.30,129.30,34.98",
    "gyeongju": "129.05,35.95,129.40,35.70",
    "pohang": "129.20,36.20,129.62,35.90",
}
CANDIDATES = [
    ("busan", "광안리", "ATTRACTION", "광안리해수욕장"),
    ("busan", "해운대", "ATTRACTION", "해운대해수욕장"),
    ("busan", "흰여울문화마을", "ATTRACTION", "흰여울문화마을"),
    ("busan", "감천문화마을", "ATTRACTION", "감천문화마을"),
    ("busan", "전포 카페거리", "CAFE", "전포카페거리"),
    ("gyeongju", "황리단길", "ATTRACTION", "황리단길"),
    ("gyeongju", "대릉원", "ATTRACTION", "대릉원"),
    ("gyeongju", "첨성대", "ATTRACTION", "첨성대"),
    ("gyeongju", "동궁과 월지", "ATTRACTION", "동궁과 월지"),
    ("gyeongju", "월정교", "ATTRACTION", "월정교"),
    ("pohang", "영일대", "ATTRACTION", "영일대해수욕장"),
    ("pohang", "스페이스워크", "ATTRACTION", "스페이스워크"),
    ("pohang", "구룡포", "ATTRACTION", "구룡포 일본인 가옥거리"),
    ("pohang", "호미곶", "ATTRACTION", "호미곶 해맞이광장"),
    ("pohang", "죽도시장", "FOOD", "죽도시장"),
]


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out = []
    with httpx.Client(headers={"User-Agent": "OurTrip-dev/0.1 (personal trip planner; dev-time seed check)"}, timeout=20) as c:
        for city, name, cat, q in CANDIDATES:
            r = c.get("https://nominatim.openstreetmap.org/search", params={
                "q": q, "format": "jsonv2", "limit": 3, "countrycodes": "kr",
                "viewbox": CITY_BOX[city], "bounded": 1, "accept-language": "ko",
            })
            hits = r.json() if r.status_code == 200 else []
            h = hits[0] if hits else None
            out.append({
                "city": city, "name": name, "category": cat, "query": q,
                "latitude": float(h["lat"]) if h else None,
                "longitude": float(h["lon"]) if h else None,
                "osm_ref": f"{h['osm_type']}/{h['osm_id']}" if h else None,
                "osm_display_name": h["display_name"] if h else None,
                "coordinate_source": "OSM_NOMINATIM" if h else None,
            })
            print(city, name, "->", out[-1]["latitude"], out[-1]["longitude"], out[-1]["osm_display_name"])
            time.sleep(1.2)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
