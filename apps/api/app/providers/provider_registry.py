"""Single place that knows which providers exist. Business logic talks to adapters by role.

Roles: transit routing -> ODSAY (TMAP intentionally not used); rail timetable -> TAGO_TRAIN;
bus stops/arrivals -> TAGO_BUS_*; subway -> TAGO_SUBWAY; walking -> OSMnx (local).
"""
from __future__ import annotations

from . import odsay, tago_bus, tago_subway, tago_train

ADAPTERS = [odsay, tago_train, tago_bus, tago_subway]
RUNTIMES = [odsay.runtime, tago_train.runtime, tago_bus.stops_runtime, tago_bus.arrivals_runtime, tago_subway.runtime]

ROLES = {
    "ODSAY": "대중교통 경로 검색",
    "TAGO_TRAIN": "열차 시간표·역 목록",
    "TAGO_BUS_STOP": "주변 버스정류장·경유 노선",
    "TAGO_BUS_ARRIVAL": "버스 도착예정 정보",
    "TAGO_SUBWAY": "지하철역 검색·시간표",
}


def configure_all() -> None:
    for a in ADAPTERS:
        a.configure()


def statuses() -> list[dict]:
    return [{**rt.status(), "role": ROLES.get(rt.name)} for rt in RUNTIMES]
