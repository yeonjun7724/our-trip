"""Rail + itinerary tests. TAGO responses are fixtures shaped like the documented format."""
import httpx
import respx

from conftest import join_trip, make_trip, node, set_keys

TRAINS = "https://apis.data.go.kr/1613000/TrainInfo/GetStrtpntAlocFndTrainInfo"


def _trains(items):
    return httpx.Response(200, json={"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."},
                                                  "body": {"items": {"item": items}, "totalCount": len(items)}}})


def _train(no, dep, arr, dep_name="부산", arr_name="경주", grade="KTX"):
    return {"trainno": no, "traingradename": grade, "depplacename": dep_name, "arrplacename": arr_name,
            "depplandtime": dep, "arrplandtime": arr, "adultcharge": 11000}


def test_rail_without_key_is_clearly_unavailable(client):
    make_trip(client)
    r = client.get("/api/rail/timetable", params={"dep": "NAT014445", "arr": "NATH13421", "date": "2026-12-21"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "RAIL_NOT_CONFIGURED"
    assert client.get("/api/rail/stations", params={"q": "부산"}).status_code == 503


@respx.mock
def test_timetable_filters_and_no_data(client, monkeypatch):
    set_keys(monkeypatch, tago="k")
    make_trip(client)
    route = respx.get(TRAINS).mock(return_value=_trains([
        _train(101, 20261221093000, 20261221100500), _train(1201, 20261221070000, 20261221074000, grade="무궁화호"),
        _train(103, 20261221140000, 20261221143500)]))
    r = client.get("/api/rail/timetable", params={"dep": "NAT014445", "arr": "NATH13421", "date": "2026-12-21",
                                                  "from_hour": 8, "to_hour": 12}).json()
    assert r["status"] == "OK" and [t["train_no"] for t in r["trains"]] == ["101"]
    t = r["trains"][0]
    assert t["departure"].startswith("2026-12-21T09:30:00+09:00") and t["duration_minutes"] == 35
    assert r["provider"] == "TAGO" and r["data_status"] == "SCHEDULED"
    route.mock(return_value=httpx.Response(200, json={"response": {"header": {"resultCode": "03", "resultMsg": "NODATA_ERROR"}}}))
    r = client.get("/api/rail/timetable", params={"dep": "NAT1", "arr": "NAT2", "date": "2027-06-01"}).json()
    assert r["status"] == "NO_TRAINS" and r["direct_available"] is False
    route.mock(return_value=httpx.Response(403, json={"OpenAPI_ServiceResponse": {"cmmMsgHeader": {"returnReasonCode": "30"}}}))
    r = client.get("/api/rail/timetable", params={"dep": "NAT3", "arr": "NAT4", "date": "2026-12-21"})
    assert r.status_code == 502 and r.json()["error"]["code"] == "RAIL_AUTH_FAILED"


@respx.mock
def test_transfer_candidates_respect_min_transfer(client, monkeypatch):
    set_keys(monkeypatch, tago="k")
    make_trip(client)

    def side(request):
        p = dict(request.url.params)
        if p["arrPlaceId"] == "VIA":
            return _trains([_train(1, 20261222090000, 20261222100000)])
        return _trains([_train(2, 20261222100500, 20261222110000), _train(3, 20261222102000, 20261222112000)])
    respx.get(TRAINS).mock(side_effect=side)
    r = client.get("/api/rail/transfer-candidates", params={"dep": "A", "via": "VIA", "arr": "B",
                                                            "date": "2026-12-22", "min_transfer": 15}).json()
    assert r["status"] == "OK" and r["candidates"][0]["second"]["train_no"] == "3"
    assert r["candidates"][0]["transfer_minutes"] == 20 and "보장되지 않으며" in r["notice"]


def test_reservations_pass_count_and_connection_checks(client, client2):
    t = make_trip(client, start_date="2026-12-20", end_date="2026-12-23", rail_pass_type="SELECT_3")["trip"]
    join_trip(client, client2)
    day1, day2 = t["days"][0], t["days"][1]
    # a place on DAY 2 morning, then the train
    lat, lon = node(0, 0)
    p = client.post(f"/api/trips/{t['id']}/places", json={"name": "숙소", "city": "busan", "category": "LODGING",
                                                          "latitude": lat, "longitude": lon, "coordinate_source": "USER_PICKED"}).json()["place"]
    s_lat, s_lon = node(0, 5)
    res = client2.post(f"/api/trips/{t['id']}/rail-reservations", json={
        "train_number": "101", "train_type": "KTX", "origin_station_name": "부산", "destination_station_name": "경주",
        "scheduled_departure": "2026-12-21T09:30:00+09:00", "scheduled_arrival": "2026-12-21T10:05:00+09:00",
        "from_timetable": True, "origin_lat": s_lat, "origin_lon": s_lon}).json()
    assert res["schedule_source"] == "TAGO_TIMETABLE" and res["status_label"] == "예매 전"
    # lodging set as day start; walking ~500 m to the station
    v = client.get(f"/api/trips/{t['id']}").json()["days"][1]["version"]
    assert v == day2["version"] + 1  # linking the train bumped the day version
    r = client.patch(f"/api/trips/{t['id']}/days/{day2['id']}", json={"version": v, "lodging_place_id": p["id"],
                                                                     "start_time": "09:00"})
    assert r.status_code == 200
    it = client.get(f"/api/trips/{t['id']}/itinerary").json()
    d2 = it["days"][1]
    rail = [e for e in d2["entries"] if e["kind"] == "RAIL"][0]
    assert rail["leg_in"]["source"] == "OSMNX" and rail["departure"] == "09:30"
    assert rail["connection"] == "LIKELY_OK"  # ~8 min walk + 20 min buffer before 09:30
    # start later -> buffer short
    d2v = client.get(f"/api/trips/{t['id']}").json()["days"][1]["version"]
    client.patch(f"/api/trips/{t['id']}/days/{day2['id']}", json={"version": d2v, "start_time": "09:15"})
    cc = client.post("/api/itinerary/check-connections", json={"trip_id": t["id"]}).json()
    assert cc["connections"][0]["connection"] == "BUFFER_SHORT"
    assert "계획 버퍼" in cc["buffer_note"]
    # user-entered train time is never shown as verified
    client.post(f"/api/trips/{t['id']}/rail-reservations", json={
        "origin_station_name": "경주", "destination_station_name": "포항",
        "scheduled_departure": "2026-12-22T09:00:00+09:00", "scheduled_arrival": "2026-12-22T09:40:00+09:00"})
    client.post(f"/api/trips/{t['id']}/rail-reservations", json={"origin_station_name": "포항",
                "destination_station_name": "서울", "travel_date": "2026-12-23", "reservation_status": "RESERVED"})
    client.post(f"/api/trips/{t['id']}/rail-reservations", json={"origin_station_name": "서울",
                "destination_station_name": "부산", "travel_date": "2026-12-20"})
    ps = client.get(f"/api/trips/{t['id']}/rail-pass").json()
    assert ps["rail_day_count"] == 4 and ps["allowed_days"] == 3
    assert any("선택 3일권" in w for w in ps["warnings"])
    d3 = client.get(f"/api/trips/{t['id']}/itinerary").json()["days"][2]
    r3 = [e for e in d3["entries"] if e["kind"] == "RAIL"][0]
    assert r3["schedule_source"] == "USER_ENTERED" and r3["connection"] in ("TIMETABLE_UNVERIFIED",)


def test_itinerary_order_conflict_visited_and_optimise(client, client2):
    t = make_trip(client)["trip"]
    join_trip(client, client2)
    day = t["days"][0]
    ids = []
    for name, (i, j) in [("A", (0, 0)), ("C", (5, 5)), ("B", (0, 1)), ("D", (5, 4))]:
        lat, lon = node(i, j)
        ids.append(client.post(f"/api/trips/{t['id']}/places", json={
            "name": name, "city": "busan", "latitude": lat, "longitude": lon, "coordinate_source": "USER_PICKED",
            "stay_minutes": 30}).json()["place"]["id"])
    nl = client.post(f"/api/trips/{t['id']}/places", json={"name": "위치없음", "city": "busan"}).json()["place"]["id"]
    r = client.post(f"/api/trips/{t['id']}/itinerary", json={"day_id": day["id"], "base_version": day["version"],
                                                            "items": [{"place_id": p} for p in ids + [nl]]})
    assert r.status_code == 200
    d = r.json()["days"][0]
    assert [e["name"] for e in d["entries"]] == ["A", "C", "B", "D", "위치없음"]
    assert d["entries"][0]["start"] == "09:00" and d["entries"][1]["leg_in"]["source"] == "OSMNX"
    assert d["entries"][-1]["leg_in"]["status"] == "UNAVAILABLE" and d["entries"][-1]["start"] is None
    assert d["unknown_legs"] == 1
    # stale base version from the other device -> 409
    stale = client2.post(f"/api/trips/{t['id']}/itinerary", json={"day_id": day["id"], "base_version": day["version"],
                                                                  "items": []})
    assert stale.status_code == 409
    # fix C (2nd) at 11:00 -> it must stay in place after optimisation
    c_item = d["entries"][1]
    client.patch(f"/api/itinerary-items/{c_item['item_id']}", json={"version": c_item["version"], "is_fixed": True,
                                                                     "planned_start": "11:00"})
    prop = client.post(f"/api/trips/{t['id']}/optimize", json={"day_id": day["id"]}).json()
    entries = {e["item_id"]: e["name"] for e in d["entries"]}
    names = [entries[i] for i in prop["proposed_order"]]
    assert names[1] == "C" and names[0] == "A" and names[-1] == "위치없음"
    assert prop["after"]["walk_distance_m"] <= prop["before"]["walk_distance_m"]
    # nothing applied until approval
    cur = client.get(f"/api/trips/{t['id']}/itinerary").json()["days"][0]
    assert [e["name"] for e in cur["entries"]] == ["A", "C", "B", "D", "위치없음"]
    ok = client.post(f"/api/trips/{t['id']}/itinerary", json={"day_id": day["id"], "base_version": prop["base_version"],
                                                             "items": [{"item_id": i} for i in prop["proposed_order"]]})
    assert ok.status_code == 200
    fixed = [e for e in ok.json()["days"][0]["entries"] if e["name"] == "C"][0]
    assert fixed["start"] == "11:00" and fixed["is_fixed"]
    # visited check by partner
    e0 = ok.json()["days"][0]["entries"][0]
    v = client2.patch(f"/api/itinerary-items/{e0['item_id']}", json={"version": e0["version"], "visit_status": "VISITED"})
    assert v.status_code == 200
    again = client.patch(f"/api/itinerary-items/{e0['item_id']}", json={"version": e0["version"], "visit_status": "SKIPPED"})
    assert again.status_code == 409


def test_day_assignment_suggestions_need_approval(client, client2):
    t = make_trip(client)["trip"]
    join_trip(client, client2)
    a = client.post(f"/api/trips/{t['id']}/places", json={"name": "첨성대", "city": "gyeongju", "preference": "MUST"}).json()["place"]
    client2.post(f"/api/places/{a['id']}/votes", json={"preference": "MUST"})
    b = client.post(f"/api/trips/{t['id']}/places", json={"name": "죽도시장", "city": "pohang", "preference": "SKIP"}).json()["place"]
    client2.post(f"/api/places/{b['id']}/votes", json={"preference": "SKIP"})
    s = client.post(f"/api/trips/{t['id']}/optimize", json={}).json()
    assert s["kind"] == "DAY_ASSIGNMENT"
    assert [x["name"] for x in s["suggestions"]] == ["첨성대"] and s["suggestions"][0]["day_number"] == 2
    it = client.get(f"/api/trips/{t['id']}/itinerary").json()
    assert all(not d["entries"] for d in it["days"])


def test_saved_transit_leg_is_used_and_marked(client):
    t = make_trip(client)["trip"]
    day = t["days"][0]
    p1 = client.post(f"/api/trips/{t['id']}/places", json={"name": "X", "city": "busan", "latitude": node(0, 0)[0],
                     "longitude": node(0, 0)[1], "coordinate_source": "USER_PICKED"}).json()["place"]
    p2 = client.post(f"/api/trips/{t['id']}/places", json={"name": "해운대", "city": "busan", "latitude": 35.1587,
                     "longitude": 129.1604, "coordinate_source": "USER_PICKED"}).json()["place"]
    d = client.post(f"/api/trips/{t['id']}/itinerary", json={"day_id": day["id"], "base_version": day["version"],
                    "items": [{"place_id": p1["id"]}, {"place_id": p2["id"]}]}).json()["days"][0]
    assert d["entries"][1]["leg_in"]["reason"] == "OUT_OF_GRAPH" and d["entries"][1]["start"] is None
    a, b = d["entries"][0]["item_id"], d["entries"][1]["item_id"]
    assert client.post(f"/api/trips/{t['id']}/legs", json={"from_item_id": a, "to_item_id": b, "mode": "TRANSIT",
                       "duration_minutes": 45, "transfer_count": 1, "summary": "1호선 → 1003", "source": "ODSAY"}).status_code == 201
    d = client.get(f"/api/trips/{t['id']}/itinerary").json()["days"][0]
    leg = d["entries"][1]["leg_in"]
    assert leg["source"] == "ODSAY" and leg["status"] == "ESTIMATED" and d["entries"][1]["start"] == "10:45"
