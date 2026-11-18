"""Walking routes on prebuilt OSMnx walk graphs (GraphML in GRAPH_DATA_DIR).

Never calls Overpass at request time. Straight lines are never returned as walking routes:
if no network path exists, the status says so and geometry is None.
"""
from __future__ import annotations

import json
import logging
import math
import threading
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import networkx as nx
import numpy as np

from ..config import get_settings

log = logging.getLogger("ourtrip.osmnx")

SNAP_WARN_M = 80.0
SNAP_MAX_M = 300.0
EARTH_R = 6371008.8


def haversine(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dl = np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_R * np.arcsin(np.sqrt(a))


@dataclass
class Zone:
    zone_id: str
    city: str
    label: str
    lat: float
    lon: float
    half_size_m: float
    built_at: str | None
    path: Path

    def contains(self, lat: float, lon: float, margin_m: float = 0) -> bool:
        dy = abs(lat - self.lat) * 111_320
        dx = abs(lon - self.lon) * 111_320 * math.cos(math.radians(self.lat))
        return dy <= self.half_size_m - margin_m and dx <= self.half_size_m - margin_m


class LoadedGraph:
    def __init__(self, zone: Zone):
        import osmnx as ox  # heavy import, only when a graph is actually needed

        self.zone = zone
        self.G = ox.load_graphml(zone.path)
        nodes = list(self.G.nodes(data=True))
        self.node_ids = np.array([n for n, _ in nodes])
        self.lats = np.array([d["y"] for _, d in nodes], dtype=float)
        self.lons = np.array([d["x"] for _, d in nodes], dtype=float)
        self.version = f"{zone.zone_id}@{zone.built_at or 'unknown'}"

    def snap(self, lat: float, lon: float) -> tuple[int, float]:
        d = haversine(lat, lon, self.lats, self.lons)
        i = int(np.argmin(d))
        return int(self.node_ids[i]), float(d[i])

    def coord(self, n) -> tuple[float, float]:
        d = self.G.nodes[n]
        return d["x"], d["y"]

    def edge_coords(self, u, v) -> tuple[list[tuple[float, float]], float]:
        data = min(self.G.get_edge_data(u, v).values(), key=lambda e: e.get("length", math.inf))
        length = float(data.get("length", 0.0))
        geom = data.get("geometry")
        if geom is not None:
            coords = list(geom.coords)
            ux, uy = self.coord(u)
            if (coords[0][0] - ux) ** 2 + (coords[0][1] - uy) ** 2 > (coords[-1][0] - ux) ** 2 + (coords[-1][1] - uy) ** 2:
                coords.reverse()
        else:
            coords = [self.coord(u), self.coord(v)]
        return coords, length


class GraphRegistry:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.zones: dict[str, Zone] = {}
        self.manifest: dict = {}
        self._loaded: dict[str, LoadedGraph] = {}
        self._lock = threading.Lock()
        self.reload_manifest()

    def reload_manifest(self) -> None:
        mpath = self.data_dir / "manifest.json"
        self.zones.clear()
        if not mpath.exists():
            log.warning("graph manifest missing at %s", mpath)
            return
        self.manifest = json.loads(mpath.read_text("utf-8"))
        for zid, z in self.manifest.get("zones", {}).items():
            p = self.data_dir / f"{zid}.graphml"
            if p.exists():
                self.zones[zid] = Zone(zid, z["city"], z["label"], z["centre"][0], z["centre"][1],
                                       z["half_size_m"], z.get("built_at"), p)

    def zones_for(self, lat: float, lon: float) -> list[Zone]:
        return [z for z in self.zones.values() if z.contains(lat, lon)]

    def common_zone(self, a: tuple[float, float], b: tuple[float, float]) -> Zone | None:
        cands = [z for z in self.zones_for(*a) if z.contains(*b)]
        if not cands:
            return None
        # prefer the zone in which both points are most central
        return min(cands, key=lambda z: max(abs(a[0] - z.lat), abs(b[0] - z.lat)) + max(abs(a[1] - z.lon), abs(b[1] - z.lon)))

    def get(self, zone_id: str) -> LoadedGraph:
        with self._lock:
            if zone_id not in self._loaded:
                log.info("loading graph %s", zone_id)
                self._loaded[zone_id] = LoadedGraph(self.zones[zone_id])
            return self._loaded[zone_id]

    def stops_geojson(self, zone_id: str) -> dict:
        p = self.data_dir / f"{zone_id}_stops.geojson"
        return json.loads(p.read_text("utf-8")) if p.exists() else {"type": "FeatureCollection", "features": []}

    def info(self) -> dict:
        return {
            "zones": [{"zone_id": z.zone_id, "city": z.city, "label": z.label, "built_at": z.built_at,
                       "loaded": z.zone_id in self._loaded} for z in self.zones.values()],
            "osmnx_version": self.manifest.get("osmnx_version"),
            "license": self.manifest.get("license"),
        }


_registry: GraphRegistry | None = None


def registry() -> GraphRegistry:
    global _registry
    if _registry is None:
        _registry = GraphRegistry(get_settings().graph_data_dir)
    return _registry


def set_registry(r: GraphRegistry | None) -> None:
    global _registry
    _registry = r
    _cached_route.cache_clear()


def minutes_for(distance_m: float, speed_kmh: float) -> float:
    return round(distance_m / (speed_kmh * 1000 / 60), 1)


def walk_route(lat1: float, lon1: float, lat2: float, lon2: float, speed_kmh: float = 4.0) -> dict:
    r = _cached_route(round(lat1, 6), round(lon1, 6), round(lat2, 6), round(lon2, 6))
    out = dict(r)
    if out.get("distance_m") is not None:
        out["duration_minutes"] = minutes_for(out["distance_m"], speed_kmh)
    out["speed_kmh"] = speed_kmh
    return out


@lru_cache(maxsize=4096)
def _cached_route(lat1, lon1, lat2, lon2) -> dict:
    reg = registry()
    base = {"geometry": None, "distance_m": None, "duration_minutes": None, "graph_version": None,
            "snap_distance_m": None, "warnings": [], "zone": None}
    if not reg.zones:
        return {**base, "status": "GRAPH_MISSING", "warnings": ["보행 네트워크 파일이 없어 도보 경로를 계산할 수 없어요."]}
    zone = reg.common_zone((lat1, lon1), (lat2, lon2))
    if zone is None:
        return {**base, "status": "OUT_OF_GRAPH",
                "warnings": ["두 지점이 같은 보행 네트워크 범위 안에 있지 않아요. 대중교통 경로를 확인해 주세요."]}
    g = reg.get(zone.zone_id)
    n1, d1 = g.snap(lat1, lon1)
    n2, d2 = g.snap(lat2, lon2)
    base.update(graph_version=g.version, snap_distance_m=[round(d1, 1), round(d2, 1)], zone=zone.zone_id)
    if max(d1, d2) > SNAP_MAX_M:
        return {**base, "status": "SNAP_TOO_FAR",
                "warnings": [f"보행 네트워크에서 {max(d1, d2):.0f}m 떨어진 지점이라 경로를 계산하지 않았어요."]}
    warnings = []
    if max(d1, d2) > SNAP_WARN_M:
        warnings.append(f"가장 가까운 보행로까지 {max(d1, d2):.0f}m 떨어져 있어요. 실제와 차이가 있을 수 있어요.")
    if n1 == n2:
        return {**base, "status": "OK", "distance_m": round(d1 + d2, 1),
                "geometry": {"type": "LineString", "coordinates": [[lon1, lat1], [lon2, lat2]]},
                "warnings": warnings + ["같은 보행 노드에 연결된 매우 가까운 지점이에요."]}
    try:
        path = nx.shortest_path(g.G, n1, n2, weight="length")
    except nx.NetworkXNoPath:
        return {**base, "status": "NO_PATH", "warnings": ["보행 네트워크상 연결된 경로가 없어요(도로망 단절)."]}
    coords: list[tuple[float, float]] = [(lon1, lat1)]
    total = 0.0
    for u, v in zip(path[:-1], path[1:]):
        seg, length = g.edge_coords(u, v)
        total += length
        coords.extend(seg if coords[-1] != seg[0] else seg[1:])
    coords.append((lon2, lat2))
    total += d1 + d2  # connector from the real points to the snapped nodes
    return {**base, "status": "OK", "distance_m": round(total, 1), "warnings": warnings,
            "geometry": {"type": "LineString", "coordinates": [[round(x, 7), round(y, 7)] for x, y in coords]}}


def walk_distances_from(lat: float, lon: float, targets: list[tuple[float, float]],
                        cutoff_m: float = 2500) -> list[dict]:
    """One-to-many walking distances (single Dijkstra) for nearby-stop cards."""
    reg = registry()
    zones = reg.zones_for(lat, lon)
    if not zones:
        return [{"status": "OUT_OF_GRAPH"} for _ in targets]
    g = reg.get(min(zones, key=lambda z: abs(z.lat - lat) + abs(z.lon - lon)).zone_id)
    src, d0 = g.snap(lat, lon)
    if d0 > SNAP_MAX_M:
        return [{"status": "OUT_OF_GRAPH"} for _ in targets]
    lengths = nx.single_source_dijkstra_path_length(g.G, src, cutoff=cutoff_m, weight="length")
    out = []
    for tlat, tlon in targets:
        if not g.zone.contains(tlat, tlon):
            out.append({"status": "OUT_OF_GRAPH"})
            continue
        n, dt = g.snap(tlat, tlon)
        if dt > SNAP_MAX_M:
            out.append({"status": "OUT_OF_GRAPH"})
        elif n in lengths:
            out.append({"status": "OK", "distance_m": round(lengths[n] + d0 + dt, 1)})
        else:
            out.append({"status": "NO_PATH"})
    return out
