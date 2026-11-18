"""Share-link analysis for Naver Map / Kakao Map links.

What we do: detect the provider, extract a place ID if it is visible in the URL, and take
a *name hint* from the text the user pasted (share text usually contains the name).
What we never do: fetch/scrape the place page, call internal APIs, or copy name/address/
coordinates from provider APIs. Short links (naver.me, kko.to) are expanded by reading only
the HTTP Location header of redirects, restricted to an allow-list of hosts, no body read.
Coordinates must be chosen by the user on our own (OSM) map.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, unquote, urlparse

import httpx

NAVER_HOSTS = {"map.naver.com", "m.map.naver.com", "naver.me", "m.place.naver.com", "place.naver.com",
               "pcmap.place.naver.com", "app.map.naver.com"}
KAKAO_HOSTS = {"map.kakao.com", "m.map.kakao.com", "place.map.kakao.com", "kko.to", "kakaomap.page.link"}
SHORT_HOSTS = {"naver.me", "kko.to", "kakaomap.page.link"}
ALLOWED = NAVER_HOSTS | KAKAO_HOSTS
URL_RE = re.compile(r"https?://[^\s<>\"']+")
NOISE = re.compile(r"^\[?(네이버\s*지도|NAVER\s*Map|카카오\s*맵|카카오맵|Kakao\s*Map)\]?\s*", re.I)


def provider_of(host: str) -> str | None:
    host = host.lower()
    if host in NAVER_HOSTS or host.endswith(".naver.com"):
        return "NAVER"
    if host in KAKAO_HOSTS:
        return "KAKAO"
    return None


def extract_place_id(url: str) -> str | None:
    u = urlparse(url)
    host = u.netloc.lower()
    path = u.path
    if provider_of(host) == "NAVER":
        m = re.search(r"/(?:entry/)?place/(\d+)", path) or re.search(
            r"/(?:restaurant|cafe|hairshop|hospital|accommodation|attraction|place)/(\d+)", path)
        if m:
            return m.group(1)
        q = parse_qs(u.query)
        for k in ("id", "placeId"):
            if q.get(k) and q[k][0].isdigit():
                return q[k][0]
    if provider_of(host) == "KAKAO":
        if host == "place.map.kakao.com":
            m = re.match(r"/(?:m/)?(\d+)", path)
            if m:
                return m.group(1)
        q = parse_qs(u.query)
        for k in ("itemId", "confirmid", "placeId"):
            if q.get(k) and q[k][0].isdigit():
                return q[k][0]
    return None


def name_hint_from_text(text: str, url: str | None) -> tuple[str | None, str | None]:
    """Return (name_hint, address_hint) from the user's pasted share text."""
    body = text.replace(url, " ") if url else text
    lines = [NOISE.sub("", l).strip(" \t-·|") for l in re.split(r"[\r\n]+", body)]
    lines = [l for l in lines if l and not URL_RE.search(l)]
    if not lines:
        # kakao "link/map/<name>,<lat>,<lng>" style: take only the name part
        if url and "/link/" in url:
            seg = unquote(urlparse(url).path.split("/")[-1])
            name = seg.split(",")[0].strip()
            return (name or None), None
        return None, None
    name = lines[0][:120]
    addr = None
    for l in lines[1:]:
        if re.search(r"(시|군|구|읍|면|동|로|길)\s*\d*", l):
            addr = l[:200]
            break
    return name, addr


def _safe(url: str) -> bool:
    u = urlparse(url)
    return u.scheme == "https" and u.netloc.lower() in ALLOWED


async def expand_short(url: str, client: httpx.AsyncClient | None = None, max_hops: int = 4) -> str | None:
    own = client is None
    client = client or httpx.AsyncClient(timeout=6.0, follow_redirects=False,
                                         headers={"User-Agent": "OurTrip/0.1 link-check"})
    try:
        cur = url
        for _ in range(max_hops):
            if not _safe(cur):
                return None
            r = await client.head(cur)
            if r.status_code in (405, 404):
                async with client.stream("GET", cur) as rs:  # headers only; body not read
                    r = rs
            loc = r.headers.get("location")
            if r.status_code in (301, 302, 303, 307, 308) and loc:
                cur = str(httpx.URL(cur).join(loc))
                if urlparse(cur).netloc.lower() not in SHORT_HOSTS:
                    return cur if provider_of(urlparse(cur).netloc) else None
                continue
            return cur if cur != url else None
        return None
    except httpx.HTTPError:
        return None
    finally:
        if own:
            await client.aclose()


async def analyze(raw: str, resolve: bool = True) -> dict:
    raw = (raw or "").strip()
    m = URL_RE.search(raw)
    if not m:
        return {"valid": False, "reason": "NO_URL", "message": "붙여넣은 내용에서 링크를 찾지 못했어요. 직접 입력해 주세요."}
    url = m.group(0).rstrip(").,]")
    host = urlparse(url).netloc.lower()
    provider = provider_of(host)
    name_hint, addr_hint = name_hint_from_text(raw, m.group(0))
    if provider is None:
        return {"valid": False, "reason": "UNSUPPORTED_HOST", "url": url, "name_hint": name_hint,
                "message": "네이버 지도·카카오맵 링크가 아니에요. 장소를 직접 등록할 수 있어요."}
    resolved = None
    if host in SHORT_HOSTS and resolve:
        resolved = await expand_short(url)
    place_id = extract_place_id(resolved or url)
    if name_hint is None and resolved and "/link/" in resolved:
        name_hint, _ = name_hint_from_text("", resolved)
    return {
        "valid": True, "provider": provider, "url": url, "resolved_url": resolved,
        "provider_place_id": place_id, "name_hint": name_hint, "address_hint": addr_hint,
        "identified": bool(place_id or name_hint),
        "needs_manual_location": True,
        "message": ("링크를 확인했어요. 이름을 확인하고 지도에서 위치를 직접 찍어 주세요."
                    if (place_id or name_hint) else
                    "링크는 저장할 수 있지만 장소를 자동으로 알아내지 못했어요. 이름과 위치를 직접 입력해 주세요."),
    }
