from conftest import DLAT, DLON, LAT0, LON0, make_trip, node
from app.routing import osmnx_engine as eng


def test_normal_route_geojson_distance_time():
    a, b = node(0, 0), node(3, 4)
    r = eng.walk_route(*a, *b, 4.0)
    assert r["status"] == "OK"
    # Manhattan grid: 7 edges of ~100 m
    assert 680 < r["distance_m"] < 720
    assert abs(r["duration_minutes"] - r["distance_m"] / (4000 / 60)) < 0.2
    g = r["geometry"]
    assert g["type"] == "LineString" and len(g["coordinates"]) >= 8
    assert all(len(c) == 2 and 124 < c[0] < 132 and 33 < c[1] < 39 for c in g["coordinates"])
    assert r["graph_version"] == "test_zone@test"


def test_speed_changes_time_not_distance():
    a, b = node(0, 0), node(5, 5)
    slow, fast = eng.walk_route(*a, *b, 3.0), eng.walk_route(*a, *b, 5.0)
    assert slow["distance_m"] == fast["distance_m"] and slow["duration_minutes"] > fast["duration_minutes"]


def test_disconnected_network_returns_no_path_without_line():
    a = node(0, 0)
    iso = (LAT0 + 8 * DLAT, LON0 + 8 * DLON)
    r = eng.walk_route(*a, *iso)
    assert r["status"] == "NO_PATH" and r["geometry"] is None and r["distance_m"] is None


def test_out_of_graph_never_draws_straight_line():
    r = eng.walk_route(*node(0, 0), 35.84, 129.21)  # Gyeongju
    assert r["status"] == "OUT_OF_GRAPH" and r["geometry"] is None


def test_snap_too_far():
    # inside the zone bbox but > 300 m from any node
    r = eng.walk_route(*node(0, 0), LAT0 - 8 * DLAT + 0.0001, LON0 + 3 * DLON)
    assert r["status"] in ("SNAP_TOO_FAR", "OUT_OF_GRAPH") and r["geometry"] is None


def test_graph_files_missing(tmp_path):
    eng.set_registry(eng.GraphRegistry(tmp_path))
    r = eng.walk_route(*node(0, 0), *node(1, 1))
    assert r["status"] == "GRAPH_MISSING" and r["geometry"] is None


def test_walking_endpoint(client):
    make_trip(client)
    a, b = node(0, 0), node(2, 2)
    r = client.post("/api/routes/walking", json={"origin": {"lat": a[0], "lon": a[1]},
                                                  "destination": {"lat": b[0], "lon": b[1]}}).json()
    assert r["status"] == "OK" and r["feature"]["properties"]["source"] == "OSMNX"
    assert r["freshness"]["status"] == "ESTIMATED" and r["speed_kmh"] == 4.0
