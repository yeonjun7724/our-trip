from app.config import get_settings


def test_open_map_pick_name_and_shared_trip(app, client, client2, monkeypatch):
    from fastapi.testclient import TestClient
    info = client.get("/api/bootstrap").json()
    assert info["access_code_required"] is False
    base_members = len(info["members"])
    r = client.post("/api/bootstrap", json={"nickname": "연준"})
    assert r.status_code == 200
    trip_id = r.json()["trip_id"]
    # second phone joins the same shared trip
    r2 = client2.post("/api/bootstrap", json={"nickname": "민수"})
    assert r2.json()["trip_id"] == trip_id
    assert len(client.get(f"/api/trips/{trip_id}").json()["members"]) == base_members + 2
    # seeded once, shared
    assert len(client2.get(f"/api/trips/{trip_id}/places").json()) >= 42
    # third device picks an existing name instead of duplicating
    with TestClient(app) as c3:
        mid = r2.json()["member"]["id"]
        assert c3.post("/api/bootstrap", json={"member_id": mid}).json()["member"]["nickname"] == "민수"
    assert client.get("/api/bootstrap").json()["members"][-1]["nickname"] == "민수"
    assert client.post("/api/bootstrap", json={}).status_code == 422


def test_access_code(client, monkeypatch):
    monkeypatch.setenv("ACCESS_CODE", "busan2026")
    get_settings.cache_clear()
    assert client.get("/api/bootstrap").json()["access_code_required"] is True
    assert client.post("/api/bootstrap", json={"nickname": "x"}).status_code == 403
    assert client.post("/api/bootstrap", json={"nickname": "x", "access_code": "busan2026"}).status_code == 200
