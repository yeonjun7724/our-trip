"""OpenStreetMap Nominatim search — only on an explicit user button press.

Policy (operations.osmfoundation.org/policies/nominatim): ≤1 request/s, identifying
User-Agent, no autocomplete, caching encouraged. Results are ODbL and may be stored with
attribution; we store the chosen coordinate with coordinate_source=OSM_NOMINATIM + osm_ref.
"""
from __future__ import annotations

import asyncio
import time

import httpx

from ..config import get_settings
from ..errors import AppError

CITY_VIEWBOX = {
    "busan": "128.85,35.30,129.30,34.98",
    "gyeongju": "129.00,36.05,129.45,35.65",
    "pohang": "129.15,36.25,129.62,35.85",
}
_lock = asyncio.Lock()
_last = 0.0
_cache: dict[str, tuple[float, list]] = {}


async def search(q: str, city: str | None) -> list[dict]:
    global _last
    if not get_settings().enable_geocoding:
        raise AppError(503, "GEOCODING_DISABLED", "장소 검색이 꺼져 있어요. 지도에서 직접 위치를 선택해 주세요.")
    q = q.strip()[:100]
    if len(q) < 2:
        raise AppError(422, "QUERY_TOO_SHORT", "두 글자 이상 입력해 주세요.")
    key = f"{city}:{q}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < 86400:
        return hit[1]
    params = {"q": q, "format": "jsonv2", "limit": 6, "countrycodes": "kr", "accept-language": "ko"}
    if city in CITY_VIEWBOX:
        params.update(viewbox=CITY_VIEWBOX[city], bounded=1)
    async with _lock:
        wait = 1.1 - (time.monotonic() - _last)
        if wait > 0:
            await asyncio.sleep(wait)
        _last = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=10, headers={
                    "User-Agent": "OurTrip/0.1 (personal two-person trip planner)"}) as c:
                r = await c.get("https://nominatim.openstreetmap.org/search", params=params)
        except httpx.HTTPError as exc:
            raise AppError(502, "GEOCODING_UNAVAILABLE", "OSM 장소 검색에 연결하지 못했어요. 지도에서 직접 선택해 주세요.") from exc
    if r.status_code != 200:
        raise AppError(502, "GEOCODING_UNAVAILABLE", "OSM 장소 검색이 응답하지 않아요. 지도에서 직접 선택해 주세요.")
    out = [{"name": h.get("name") or h["display_name"].split(",")[0], "display_name": h["display_name"],
            "lat": float(h["lat"]), "lon": float(h["lon"]), "osm_ref": f"{h['osm_type']}/{h['osm_id']}",
            "category": h.get("category"), "type": h.get("type")} for h in r.json()]
    _cache[key] = (time.time(), out)
    return out
