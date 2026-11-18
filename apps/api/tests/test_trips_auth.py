from conftest import join_trip, make_trip


def test_create_trip_without_dates_creates_four_days(client):
    data = make_trip(client)
    days = data["trip"]["days"]
    assert [d["primary_city"] for d in days] == ["busan", "gyeongju", "pohang", "pohang"]
    assert all(d["travel_date"] is None for d in days)
    assert data["recovery_key"]
    assert "ourtrip_session" in client.cookies
    me = client.get("/api/me").json()
    assert me["authenticated"] and me["member"]["role"] == "OWNER"


def test_dates_set_day_dates_and_extend(client):
    t = make_trip(client, start_date="2026-12-20", end_date="2026-12-23")["trip"]
    assert [d["travel_date"] for d in t["days"]] == ["2026-12-20", "2026-12-21", "2026-12-22", "2026-12-23"]
    r = client.patch(f"/api/trips/{t['id']}", json={"version": t["version"], "end_date": "2026-12-24"})
    assert r.status_code == 200
    assert len(r.json()["days"]) == 5
    # stale version -> conflict
    r2 = client.patch(f"/api/trips/{t['id']}", json={"version": t["version"], "title": "x"})
    assert r2.status_code == 409 and r2.json()["error"]["code"] == "VERSION_CONFLICT"


def test_seed_candidates_never_invent_coordinates(client):
    data = make_trip(client, seed_candidates=True)
    places = client.get(f"/api/trips/{data['trip']['id']}/places").json()
    assert data["seeded_places"] == len(places) == 15
    for p in places:
        if p["latitude"] is None:
            assert p["coordinate_source"] == "NONE"
        else:
            assert p["coordinate_source"] == "OSM_NOMINATIM" and p["osm_ref"]


def test_invite_join_separate_sessions_and_access_control(client, client2, app):
    from fastapi.testclient import TestClient
    t = make_trip(client)["trip"]
    joined = join_trip(client, client2)
    assert joined["trip_id"] == t["id"]
    m1 = client.get("/api/me").json()["member"]
    m2 = client2.get("/api/me").json()["member"]
    assert m1["id"] != m2["id"] and m2["role"] == "MEMBER"
    members = client2.get(f"/api/trips/{t['id']}").json()["members"]
    assert {m["nickname"] for m in members} == {"연준", "여자친구"}
    # non-owner can't create invites
    assert client2.post(f"/api/trips/{t['id']}/invites").status_code == 403
    # a third person with their own trip cannot see this trip
    with TestClient(app) as c3:
        other = make_trip(c3, title="다른 여행")["trip"]
        assert c3.get(f"/api/trips/{t['id']}").status_code == 404
        assert c3.get(f"/api/trips/{t['id']}/places").status_code == 404
        assert client.get(f"/api/trips/{other['id']}").status_code == 404
    # anonymous
    with TestClient(app) as anon:
        assert anon.get(f"/api/trips/{t['id']}").status_code == 401


def test_invite_single_use_revoke_and_preview(client, client2, app):
    from fastapi.testclient import TestClient
    t = make_trip(client)["trip"]
    inv = client.post(f"/api/trips/{t['id']}/invites").json()
    assert "/join#" in inv["url"]
    pv = client2.post("/api/invites/preview", json={"token": inv["token"]})
    assert pv.status_code == 200 and pv.json()["trip_title"] == "부경포 여행"
    assert client2.post("/api/invites/join", json={"token": inv["token"], "nickname": "a"}).status_code == 200
    with TestClient(app) as c3:
        r = c3.post("/api/invites/join", json={"token": inv["token"], "nickname": "b"})
        assert r.status_code == 410 and r.json()["error"]["code"] == "INVITE_USED"
        inv2 = client.post(f"/api/trips/{t['id']}/invites").json()
        assert client.delete(f"/api/invites/{inv2['invite_id']}").status_code == 200
        r = c3.post("/api/invites/join", json={"token": inv2["token"], "nickname": "b"})
        assert r.status_code == 404
        assert c3.post("/api/invites/join", json={"token": "x" * 20, "nickname": "b"}).status_code == 404
    states = {i["state"] for i in client.get(f"/api/trips/{t['id']}/invites").json()}
    assert states == {"USED", "REVOKED"}


def test_rejoin_existing_member_on_new_device(client, client2, app):
    from fastapi.testclient import TestClient
    t = make_trip(client)["trip"]
    j = join_trip(client, client2)
    inv = client.post(f"/api/trips/{t['id']}/invites").json()
    with TestClient(app) as phone2:
        r = phone2.post("/api/invites/join", json={"token": inv["token"], "rejoin_member_id": j["member"]["id"]})
        assert r.status_code == 200
        assert phone2.get("/api/me").json()["member"]["id"] == j["member"]["id"]
    assert len(client.get(f"/api/trips/{t['id']}").json()["members"]) == 2


def test_recovery_key_and_logout(client, app):
    from fastapi.testclient import TestClient
    data = make_trip(client)
    client.post("/api/logout")
    assert client.get("/api/me").json()["authenticated"] is False
    with TestClient(app) as c:
        assert c.post("/api/trips/recover", json={"trip_id": data["trip"]["id"], "recovery_key": "wrong-key-xxxx"}).status_code == 404
        r = c.post("/api/trips/recover", json={"trip_id": data["trip"]["id"], "recovery_key": data["recovery_key"]})
        assert r.status_code == 200
        assert c.get("/api/me").json()["member"]["role"] == "OWNER"


def test_cross_origin_mutation_rejected(client):
    r = client.post("/api/trips", json={"title": "x", "nickname": "y"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_activity_feed(client, client2):
    t = make_trip(client)["trip"]
    join_trip(client, client2)
    client2.post(f"/api/trips/{t['id']}/places", json={"name": "광안리", "city": "busan"})
    feed = client.get(f"/api/trips/{t['id']}/activity").json()
    assert feed[0]["member"] == "여자친구" and "광안리" in feed[0]["summary"]
    assert feed[0]["is_me"] is False
