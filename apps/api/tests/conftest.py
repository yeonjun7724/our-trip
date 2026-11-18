"""Test setup: real PostgreSQL (TEST_DATABASE_URL), synthetic OSMnx graph, mocked providers.

Fixtures here are test-only. Nothing in this directory is used by the running app.
"""
from __future__ import annotations

import json
import math
import os

import networkx as nx
import pytest

os.environ.setdefault("DATABASE_URL", os.environ.get("TEST_DATABASE_URL",
                                                     "postgresql+psycopg://ourtrip@localhost:5544/ourtrip_test"))
os.environ["TAGO_API_KEY"] = ""
os.environ["ODSAY_API_KEY"] = ""
os.environ["APP_ENV"] = "test"

from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: E402,F401
from app.config import get_settings  # noqa: E402
from app.db import Base, get_engine, reset_engine  # noqa: E402
from app.providers import provider_registry  # noqa: E402
from app.routing import osmnx_engine  # noqa: E402

# Synthetic grid near (35.115, 129.040). 6x6 nodes, ~100 m spacing, plus a disconnected pair.
LAT0, LON0 = 35.115, 129.040
DLAT = 100 / 111_320
DLON = 100 / (111_320 * math.cos(math.radians(LAT0)))


def _len(a, b):
    return float(osmnx_engine.haversine(a[1], a[0], b[1], b[0]))


def build_test_graph(tmp_path):
    import osmnx as ox

    G = nx.MultiDiGraph(crs="epsg:4326")
    pos = {}
    for i in range(6):
        for j in range(6):
            n = i * 6 + j + 1
            pos[n] = (LON0 + j * DLON, LAT0 + i * DLAT)
            G.add_node(n, x=pos[n][0], y=pos[n][1], street_count=4)
    for i in range(6):
        for j in range(6):
            n = i * 6 + j + 1
            for m in ([n + 1] if j < 5 else []) + ([n + 6] if i < 5 else []):
                L = _len(pos[n], pos[m])
                G.add_edge(n, m, key=0, length=L, osmid=n * 100 + m)
                G.add_edge(m, n, key=0, length=L, osmid=n * 100 + m)
    # isolated component ~800 m north-east (same zone, unreachable)
    a = (LON0 + 8 * DLON, LAT0 + 8 * DLAT)
    b = (LON0 + 9 * DLON, LAT0 + 8 * DLAT)
    G.add_node(1001, x=a[0], y=a[1], street_count=1)
    G.add_node(1002, x=b[0], y=b[1], street_count=1)
    G.add_edge(1001, 1002, key=0, length=_len(a, b), osmid=1)
    G.add_edge(1002, 1001, key=0, length=_len(a, b), osmid=1)
    ox.save_graphml(G, tmp_path / "test_zone.graphml")
    stops = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [LON0 + 2 * DLON, LAT0 + 1 * DLAT]},
         "properties": {"osm_id": "node/1", "kind": "BUS", "name": "테스트정류장", "ref": "05-123"}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [LON0 + 4 * DLON, LAT0 + 4 * DLAT]},
         "properties": {"osm_id": "node/2", "kind": "SUBWAY", "name": "테스트역", "ref": None}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [LON0 + 5 * DLON, LAT0 + 0 * DLAT]},
         "properties": {"osm_id": "node/3", "kind": "RAIL", "name": "부산", "ref": None}},
    ]}
    (tmp_path / "test_zone_stops.geojson").write_text(json.dumps(stops, ensure_ascii=False), encoding="utf-8")
    manifest = {"zones": {"test_zone": {"city": "busan", "label": "테스트", "centre": [LAT0 + 3 * DLAT, LON0 + 3 * DLON],
                                        "half_size_m": 1500, "built_at": "test"}},
                "osmnx_version": ox.__version__, "license": "synthetic test graph"}
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def node(i, j):
    """(lat, lon) of grid node at row i, col j."""
    return LAT0 + i * DLAT, LON0 + j * DLON


@pytest.fixture(scope="session")
def graph_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("graphs")
    build_test_graph(d)
    return d


@pytest.fixture(autouse=True)
def _env(graph_dir, monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("GRAPH_DATA_DIR", str(graph_dir))
    get_settings.cache_clear()
    osmnx_engine.set_registry(osmnx_engine.GraphRegistry(graph_dir))
    provider_registry.configure_all()
    for rt in provider_registry.RUNTIMES:
        rt._cache.clear()
        rt._cooldown_until = 0
        rt._recent.clear()
        rt.verified = False
        rt.last_error_code = None
    yield
    get_settings.cache_clear()


@pytest.fixture(scope="session", autouse=True)
def _db():
    reset_engine()
    eng = get_engine()
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield
    reset_engine()


@pytest.fixture
def app():
    from app.main import app as fastapi_app
    return fastapi_app


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def client2(app):
    with TestClient(app) as c:
        yield c


def make_trip(client, **kw):
    body = {"title": "부경포 여행", "nickname": "연준", "seed_candidates": False, **kw}
    r = client.post("/api/trips", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def join_trip(owner_client, other_client, nickname="여자친구"):
    trip = owner_client.get("/api/me").json()
    inv = owner_client.post(f"/api/trips/{trip['trip_id']}/invites").json()
    r = other_client.post("/api/invites/join", json={"token": inv["token"], "nickname": nickname})
    assert r.status_code == 200, r.text
    return r.json()


def set_keys(monkeypatch, tago: str | None = None, odsay: str | None = None):
    if tago is not None:
        monkeypatch.setenv("TAGO_API_KEY", tago)
    if odsay is not None:
        monkeypatch.setenv("ODSAY_API_KEY", odsay)
    get_settings.cache_clear()
    provider_registry.configure_all()
