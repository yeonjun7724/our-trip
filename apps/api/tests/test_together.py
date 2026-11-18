import httpx
import respx

from conftest import join_trip, make_trip, node
from app.api.together import _weather_cache


def test_expenses_and_settlement(client, client2):
    t = make_trip(client)["trip"]
    join_trip(client, client2)
    me = client.get("/api/me").json()["member"]["id"]
    pal = client2.get("/api/me").json()["member"]["id"]
    # I paid 30,000 for both; he paid 10,000 for both; he paid 5,000 only for himself
    assert client.post(f"/api/trips/{t['id']}/expenses", json={"title": "KTX", "amount": 30000, "category": "TRANSPORT",
                       "split_member_ids": [me, pal]}).status_code == 201
    client2.post(f"/api/trips/{t['id']}/expenses", json={"title": "밀면", "amount": 10000, "category": "FOOD", "split_member_ids": [me, pal]})
    client2.post(f"/api/trips/{t['id']}/expenses", json={"title": "기념품", "amount": 5000, "category": "SHOPPING"})
    r = client.get(f"/api/trips/{t['id']}/expenses").json()
    assert r["total"] == 45000 and r["by_category"]["TRANSPORT"] == 30000
    bal = {m["id"]: m["balance"] for m in r["members"]}
    assert bal[me] == 10000 and bal[pal] == -10000
    assert r["transfers"] == [{"from": pal, "to": me, "amount": 10000, "from_name": "철수", "to_name": "연준"}]
    bad = client.post(f"/api/trips/{t['id']}/expenses", json={"title": "x", "amount": 0})
    assert bad.status_code == 422
    eid = r["expenses"][0]["id"]
    assert client.delete(f"/api/expenses/{eid}").status_code == 200


def test_checklist_shared_and_deduplicated(client, client2):
    t = make_trip(client)["trip"]
    join_trip(client, client2)
    r = client.post(f"/api/trips/{t['id']}/checklist", json={"items": [{"text": "충전기"}, {"text": "신분증"}, {"text": "충전기"}]})
    assert r.json()["added"] == 2
    items = client2.get(f"/api/trips/{t['id']}/checklist").json()
    client2.patch(f"/api/checklist/{items[0]['id']}", json={"done": True})
    again = client.get(f"/api/trips/{t['id']}/checklist").json()
    assert again[0]["done"] is True and again[0]["done_by"] == "철수"
    assert client.delete(f"/api/checklist/{items[1]['id']}").status_code == 200


def test_place_comments(client, client2):
    t = make_trip(client)["trip"]
    join_trip(client, client2)
    p = client.post(f"/api/trips/{t['id']}/places", json={"name": "광안리", "city": "busan"}).json()["place"]
    client.post(f"/api/places/{p['id']}/comments", json={"text": "야경 보러 가자"})
    cs = client2.get(f"/api/places/{p['id']}/comments").json()
    assert cs[0]["text"] == "야경 보러 가자" and cs[0]["is_me"] is False and cs[0]["nickname"] == "연준"
    assert client2.delete(f"/api/comments/{cs[0]['id']}").status_code == 404  # only the author
    assert client.delete(f"/api/comments/{cs[0]['id']}").status_code == 200


def test_day_walk_geometry_only_walkable_legs(client):
    t = make_trip(client)["trip"]
    day = t["days"][0]
    ids = []
    for name, ll in [("A", node(0, 0)), ("B", node(4, 4)), ("Far", (35.84, 129.21))]:
        ids.append(client.post(f"/api/trips/{t['id']}/places", json={"name": name, "city": "busan", "latitude": ll[0],
                   "longitude": ll[1], "coordinate_source": "USER_PICKED"}).json()["place"]["id"])
    client.post(f"/api/trips/{t['id']}/itinerary", json={"day_id": day["id"], "base_version": day["version"],
                "items": [{"place_id": i} for i in ids]})
    g = client.get(f"/api/trips/{t['id']}/days/{day['id']}/walk-geometry").json()
    assert len(g["features"]) == 1 and g["features"][0]["properties"]["source"] == "OSMNX"
    assert g["skipped"] == [{"from": "B", "to": "Far", "reason": "OUT_OF_GRAPH"}]


@respx.mock
def test_weather_public_and_normalized(client):
    _weather_cache.clear()
    respx.get("https://api.open-meteo.com/v1/forecast").mock(return_value=httpx.Response(200, json={"daily": {
        "time": ["2026-12-20"], "weather_code": [3], "temperature_2m_max": [9.1], "temperature_2m_min": [1.2],
        "precipitation_probability_max": [20]}}))
    r = client.get("/api/weather").json()
    assert r["cities"]["busan"]["days"][0] == {"date": "2026-12-20", "code": 3, "tmax": 9.1, "tmin": 1.2, "rain": 20}
    assert "Open-Meteo" in r["attribution"]


def test_expense_edit_moves_day_and_resettles(client, client2):
    t = make_trip(client)["trip"]
    join_trip(client, client2)
    me = client.get("/api/me").json()["member"]["id"]
    pal = client2.get("/api/me").json()["member"]["id"]
    e = client.post(f"/api/trips/{t['id']}/expenses", json={"title": "돼지국밥", "amount": 20000, "category": "FOOD",
                    "split_member_ids": [me, pal]}).json()
    assert e["day_number"] is None
    body = {"title": "돼지국밥", "amount": 24000, "category": "FOOD", "paid_by": pal, "split_member_ids": [me, pal], "day_number": 1}
    r = client.put(f"/api/expenses/{e['id']}", json=body)
    assert r.status_code == 200 and r.json()["day_number"] == 1 and r.json()["paid_by"] == pal
    s = client.get(f"/api/trips/{t['id']}/expenses").json()
    assert s["total"] == 24000 and {m["id"]: m["balance"] for m in s["members"]}[me] == -12000
    assert client.put(f"/api/expenses/{e['id']}", json={**body, "day_number": 9}).status_code == 422  # trip has 4 days
    assert client.put("/api/expenses/nope", json=body).status_code == 404
