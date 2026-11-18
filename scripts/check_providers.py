"""Verify external provider keys with real, minimal calls (run after adding keys).

    cd apps/api && uv run python ../../scripts/check_providers.py

Prints which TAGO cities are actually listed for Busan/Gyeongju/Pohang, a sample train
query (부산→경주, tomorrow) and one ODsay route (부산역→광안리). Uses ~6 TAGO calls and
1 ODsay call. Keys are read from the environment/.env and never printed.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

from app.providers import odsay, provider_registry, tago_bus, tago_train  # noqa: E402
from app.providers.base import ProviderError  # noqa: E402

WANT = {"부산": "busan", "경주": "gyeongju", "포항": "pohang"}


async def main() -> None:
    provider_registry.configure_all()
    if tago_train.runtime.configured:
        for label, fn in (("열차 도시코드", tago_train.city_codes), ("버스정류소 도시코드", tago_bus.stop_city_codes),
                          ("버스도착 도시코드", tago_bus.arrival_city_codes)):
            try:
                codes = await fn()
                hits = {k: [c for c in codes if c["city_name"] and k in c["city_name"]] for k in WANT}
                print(f"[TAGO] {label}: " + ", ".join(f"{k}={v[0]['city_code'] if v else '미지원'}" for k, v in hits.items()))
            except ProviderError as exc:
                print(f"[TAGO] {label}: {exc.code} {exc.detail}")
        try:
            busan = [c for c in await tago_train.city_codes() if "부산" in (c["city_name"] or "")]
            st = await tago_train.stations_in_city(busan[0]["city_code"]) if busan else []
            print("[TAGO] 부산 역 예시:", [s["name"] + ":" + s["station_id"] for s in st[:6]])
        except ProviderError as exc:
            print("[TAGO] 역 목록:", exc.code)
    else:
        print("[TAGO] TAGO_API_KEY not set")
    if odsay.runtime.configured:
        try:
            opts = await odsay.search({"lat": 35.1151, "lon": 129.0422}, {"lat": 35.1532, "lon": 129.1186})
            print(f"[ODSAY] OK {len(opts)} routes, first {opts[0].total_minutes} min via {opts[0].lines}")
        except ProviderError as exc:
            print(f"[ODSAY] {exc.code} {exc.detail}")
    else:
        print("[ODSAY] ODSAY_API_KEY not set")
    print("tomorrow:", date.today() + timedelta(days=1))


if __name__ == "__main__":
    asyncio.run(main())
