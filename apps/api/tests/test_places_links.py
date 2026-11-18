import httpx
import pytest
import respx

from conftest import join_trip, make_trip, node
from app.services import link_parser


def test_place_crud_votes_and_conflict(client, client2):
    t = make_trip(client)["trip"]
    join_trip(client, client2)
    lat, lon = node(1, 1)
    r = client.post(f"/api/trips/{t['id']}/places", json={
        "name": "광안리", "city": "busan", "latitude": lat, "longitude": lon,
        "coordinate_source": "USER_PICKED", "preference": "MUST"})
    assert r.status_code == 201
    p = r.json()["place"]
    assert p["created_by"] == "연준" and p["my_vote"] == "MUST"
    # partner votes; both see both votes
    v = client2.post(f"/api/places/{p['id']}/votes", json={"preference": "GOOD"}).json()
    assert v["both_want"] is True and v["my_vote"] == "GOOD"
    seen = client.get(f"/api/trips/{t['id']}/places").json()[0]
    assert {x["preference"] for x in seen["votes"]} == {"MUST", "GOOD"}
    assert seen["priority_score"] == 3 + 2 + 2
    # concurrent edits: first wins, second gets 409 with current data
    a = client.patch(f"/api/places/{p['id']}", json={"version": p["version"], "memo": "노을"})
    b = client2.patch(f"/api/places/{p['id']}", json={"version": p["version"], "memo": "야경"})
    assert a.status_code == 200 and b.status_code == 409
    assert b.json()["error"]["details"]["current"]["memo"] == "노을"
    assert a.json()["updated_by"] == "연준"
    # delete
    assert client2.delete(f"/api/places/{p['id']}").status_code == 200
    assert client.get(f"/api/trips/{t['id']}/places").json() == []


def test_place_without_location_and_validation(client):
    t = make_trip(client)["trip"]
    r = client.post(f"/api/trips/{t['id']}/places", json={"name": "전포 카페거리", "city": "busan", "category": "CAFE"})
    assert r.status_code == 201
    assert r.json()["place"]["has_location"] is False
    # coordinates without an allowed source are rejected (no provider-copied coordinates)
    bad = client.post(f"/api/trips/{t['id']}/places", json={"name": "x", "city": "busan", "latitude": 35.1,
                                                             "longitude": 129.0, "coordinate_source": "KAKAO"})
    assert bad.status_code == 422
    assert client.post(f"/api/trips/{t['id']}/places", json={"name": "x", "city": "seoul"}).status_code == 422


def test_duplicate_warning_does_not_merge(client):
    t = make_trip(client)["trip"]
    client.post(f"/api/trips/{t['id']}/places", json={"name": "해운대", "city": "busan"})
    r = client.post(f"/api/trips/{t['id']}/places", json={"name": "해운대 ", "city": "busan"})
    assert r.json()["possible_duplicates"][0]["name"] == "해운대"
    assert len(client.get(f"/api/trips/{t['id']}/places").json()) == 2


def test_share_url_stored_as_bookmark(client):
    t = make_trip(client)["trip"]
    r = client.post(f"/api/trips/{t['id']}/places", json={
        "name": "황리단길", "city": "gyeongju", "share_url": "https://map.naver.com/p/entry/place/11491438",
        "provider_place_id": "11491438"})
    p = r.json()["place"]
    assert p["provider"] == "NAVER" and p["share_url"].endswith("11491438") and p["has_location"] is False


@pytest.mark.parametrize("text,provider,pid", [
    ("https://map.naver.com/p/entry/place/11491438?c=15.00,0,0,0,dh", "NAVER", "11491438"),
    ("https://m.place.naver.com/restaurant/1234567/home", "NAVER", "1234567"),
    ("https://place.map.kakao.com/8214366", "KAKAO", "8214366"),
    ("https://map.kakao.com/?itemId=17733090", "KAKAO", "17733090"),
])
async def test_link_detection(text, provider, pid):
    r = await link_parser.analyze(text, resolve=False)
    assert r["valid"] and r["provider"] == provider and r["provider_place_id"] == pid
    assert r["needs_manual_location"] is True


async def test_share_text_name_hint():
    text = "[네이버 지도]\n대릉원\n경상북도 경주시 황남동 31-1\nhttps://naver.me/AbCdEf12"
    r = await link_parser.analyze(text, resolve=False)
    assert r["provider"] == "NAVER" and r["name_hint"] == "대릉원"
    assert "경주시" in r["address_hint"]


@respx.mock
async def test_short_link_expansion_reads_only_redirect():
    respx.head("https://naver.me/AbCdEf12").mock(return_value=httpx.Response(
        302, headers={"location": "https://map.naver.com/p/entry/place/38712342"}))
    r = await link_parser.analyze("https://naver.me/AbCdEf12")
    assert r["resolved_url"].endswith("38712342") and r["provider_place_id"] == "38712342"


@respx.mock
async def test_short_link_to_foreign_host_is_not_followed():
    respx.head("https://kko.to/zz").mock(return_value=httpx.Response(302, headers={"location": "https://evil.example/x"}))
    r = await link_parser.analyze("https://kko.to/zz")
    assert r["valid"] and r["resolved_url"] is None and r["identified"] is False
    assert "직접" in r["message"]


@respx.mock
async def test_short_link_network_failure_falls_back():
    respx.head("https://kko.to/broken").mock(side_effect=httpx.ConnectError("down"))
    r = await link_parser.analyze("https://kko.to/broken")
    assert r["valid"] and r["provider"] == "KAKAO" and r["resolved_url"] is None


async def test_invalid_links():
    assert (await link_parser.analyze("그냥 메모"))["reason"] == "NO_URL"
    r = await link_parser.analyze("https://www.google.com/maps/place/abc")
    assert r["valid"] is False and r["reason"] == "UNSUPPORTED_HOST"


def test_links_endpoint_requires_session(app):
    from fastapi.testclient import TestClient
    with TestClient(app) as c:
        assert c.post("/api/links/validate", json={"text": "https://place.map.kakao.com/1"}).status_code == 401
