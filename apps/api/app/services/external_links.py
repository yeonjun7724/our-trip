"""Official deep links to external map apps (used when no transit provider is available)."""
from __future__ import annotations

from urllib.parse import quote

from ..schemas.common import ExternalLink


def directions(o: dict, d: dict) -> list[ExternalLink]:
    on = quote((o.get("label") or "출발").replace(",", " "))
    dn = quote((d.get("label") or "도착").replace(",", " "))
    return [
        # Kakao Map URL scheme (documented: map.kakao.com/link/from/이름,lat,lng/to/이름,lat,lng)
        ExternalLink(label="카카오맵 길찾기",
                     url=f"https://map.kakao.com/link/from/{on},{o['lat']},{o['lon']}/to/{dn},{d['lat']},{d['lon']}"),
        # Google Maps URLs API (documented: /maps/dir/?api=1&origin=&destination=&travelmode=)
        ExternalLink(label="Google 지도 대중교통",
                     url=f"https://www.google.com/maps/dir/?api=1&origin={o['lat']},{o['lon']}"
                         f"&destination={d['lat']},{d['lon']}&travelmode=transit"),
        ExternalLink(label="네이버 지도에서 도착지 검색", url=f"https://map.naver.com/p/search/{dn}"),
    ]


def place_links(name: str, lat: float | None, lon: float | None) -> list[ExternalLink]:
    n = quote(name)
    links = [ExternalLink(label="네이버 지도", url=f"https://map.naver.com/p/search/{n}")]
    if lat is not None and lon is not None:
        links.insert(0, ExternalLink(label="카카오맵", url=f"https://map.kakao.com/link/map/{n},{lat},{lon}"))
    else:
        links.append(ExternalLink(label="카카오맵", url=f"https://map.kakao.com/?q={n}"))
    return links
