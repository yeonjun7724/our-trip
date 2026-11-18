"""data.go.kr / TAGO request helper.

Handles both the JSON envelope ({"response":{"header":{resultCode},"body":{items:{item}}}})
and the XML OpenAPI_ServiceResponse error envelope that the gateway returns for key
errors even when _type=json is requested. resultCode values follow the standard
data.go.kr code table; only "00" (OK) is printed on the TAGO pages themselves.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import unquote

import httpx

from .base import AuthFailed, BadRequest, NoData, QuotaExceeded, Upstream

AUTH_CODES = {"20", "30", "31", "32"}
QUOTA_CODES = {"22"}
BAD_REQUEST_CODES = {"10", "11", "12"}
NODATA_CODES = {"03"}


def normalize_key(key: str) -> str:
    # data.go.kr issues both an "Encoding" and "Decoding" key. httpx percent-encodes
    # params itself, so we always send the decoded form.
    return unquote(key) if "%" in key else key


def _classify(code: str, msg: str, http_status: int | None):
    if code in ("00", "0", "0000"):
        return None
    if code in NODATA_CODES:
        return NoData(msg)
    if code in AUTH_CODES:
        return AuthFailed(f"{code} {msg}", http_status)
    if code in QUOTA_CODES:
        return QuotaExceeded(f"{code} {msg}", http_status)
    if code in BAD_REQUEST_CODES:
        return BadRequest(f"{code} {msg}", http_status)
    return Upstream(f"{code} {msg}", http_status)


def items_of(body: dict) -> list[dict]:
    items = body.get("items")
    if not items or isinstance(items, str):
        return []
    item = items.get("item") if isinstance(items, dict) else items
    if item is None:
        return []
    return item if isinstance(item, list) else [item]


async def tago_get(client: httpx.AsyncClient, base: str, op: str, key: str, params: dict[str, Any]) -> dict:
    q = {"serviceKey": normalize_key(key), "_type": "json", **{k: v for k, v in params.items() if v is not None}}
    resp = await client.get(f"{base}/{op}", params=q)
    text = resp.text
    if resp.status_code == 429:
        raise QuotaExceeded("HTTP 429", 429)
    if text.lstrip().startswith("<"):
        code = re.search(r"<returnReasonCode>(\d+)</returnReasonCode>", text) or re.search(r"<resultCode>(\d+)</resultCode>", text)
        msg = re.search(r"<errMsg>([^<]+)</errMsg>", text) or re.search(r"<resultMsg>([^<]+)</resultMsg>", text)
        err = _classify(code.group(1) if code else "99", msg.group(1) if msg else "XML error", resp.status_code)
        raise err or Upstream("unexpected XML response", resp.status_code)
    try:
        data = resp.json()
    except ValueError as exc:
        if resp.status_code in (401, 403):
            raise AuthFailed(f"HTTP {resp.status_code}", resp.status_code) from exc
        raise Upstream(f"invalid JSON (HTTP {resp.status_code})", resp.status_code) from exc
    gw = data.get("OpenAPI_ServiceResponse")
    if gw:  # gateway envelope — verified live: unregistered key -> HTTP 403 + code 30,
        # unknown operation -> HTTP 400 NO_OPENAPI_SERVICE_ERROR (code 12)
        h = gw.get("cmmMsgHeader", {})
        err = _classify(str(h.get("returnReasonCode", "99")), str(h.get("errMsg", "")), resp.status_code)
        raise err or Upstream("gateway error", resp.status_code)
    if resp.status_code in (401, 403):
        raise AuthFailed(f"HTTP {resp.status_code}", resp.status_code)
    if resp.status_code >= 500:
        raise Upstream(f"HTTP {resp.status_code}", resp.status_code)
    if resp.status_code >= 400:
        raise BadRequest(f"HTTP {resp.status_code}", resp.status_code)
    r = data.get("response", data)
    header = r.get("header", {})
    err = _classify(str(header.get("resultCode", "00")), str(header.get("resultMsg", "")), resp.status_code)
    if err:
        raise err
    body = r.get("body") or {}
    return body if isinstance(body, dict) else {}


async def tago_get_all(client, base, op, key, params, page_size: int = 100, max_pages: int = 10) -> list[dict]:
    out: list[dict] = []
    for page in range(1, max_pages + 1):
        try:
            body = await tago_get(client, base, op, key, {**params, "numOfRows": page_size, "pageNo": page})
        except NoData:
            break
        batch = items_of(body)
        out.extend(batch)
        total = int(body.get("totalCount") or 0)
        if len(batch) < page_size or len(out) >= total:
            break
    return out
