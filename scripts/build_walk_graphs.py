"""Build OSMnx walking graphs + OSM transit-stop layers for Our Trip zones.

Run in a development environment (NOT on every request in production).

Mode A — from a Geofabrik extract (recommended; public Overpass is often overloaded):
    curl -L -o .osm_extract/south-korea-latest.osm.pbf https://download.geofabrik.de/asia/south-korea-latest.osm.pbf
    cd apps/api && uv run python ../../scripts/build_walk_graphs.py --pbf ../../.osm_extract/south-korea-latest.osm.pbf

  Ways are filtered with the same rule OSMnx 2.x uses for network_type="walk", written to a
  per-zone OSM XML file and loaded with osmnx.graph_from_xml(bidirectional=True).

Mode B — from Overpass via osmnx.graph_from_point(network_type="walk"):
    cd apps/api && uv run python ../../scripts/build_walk_graphs.py --overpass [zone ...]

Outputs into data/graphs/:
  <zone>.graphml          OSMnx walk network
  <zone>_stops.geojson    OSM bus stops / rail & subway stations in the zone
  manifest.json           build time, extent, OSM data timestamp, OSMnx version, counts

Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
Zone centres/sizes below only define the *extent*; they are not place coordinates.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import quoteattr

import osmnx as ox

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "graphs"
WORK = ROOT / ".osm_extract"

# zone_id: (city, label, (lat, lon) centre of bbox, half-size metres)
ZONES: dict[str, tuple[str, str, tuple[float, float], int]] = {
    "busan_haeundae": ("busan", "해운대·광안리", (35.157, 129.140), 3500),
    "busan_central": ("busan", "부산역·남포·영도·감천", (35.100, 129.035), 3200),
    "busan_seomyeon": ("busan", "서면·전포", (35.155, 129.062), 1800),
    "gyeongju_downtown": ("gyeongju", "경주 시내·황리단길·대릉원", (35.835, 129.215), 3000),
    "gyeongju_station": ("gyeongju", "경주역(KTX) 주변", (35.798, 129.139), 1200),
    "pohang_downtown": ("pohang", "포항 시내·영일대·죽도시장·포항역", (36.050, 129.365), 4000),
    "pohang_guryongpo": ("pohang", "구룡포", (35.989, 129.556), 1500),
    "pohang_homigot": ("pohang", "호미곶", (36.077, 129.567), 1500),
}

# OSMnx 2.x network_type="walk" filter, expressed as Python checks (Overpass "!~" = regex not found)
WALK_HW_EXCLUDE = re.compile(r"abandoned|bus_guideway|construction|cycleway|motor|no|planned|platform|proposed|raceway|razed")


def walk_ok(t: dict) -> bool:
    hw = t.get("highway")
    if not hw or WALK_HW_EXCLUDE.search(hw):
        return False
    if re.search(r"yes", t.get("area", "")):
        return False
    if re.search(r"private", t.get("access", "")) or re.search(r"no", t.get("foot", "")):
        return False
    if re.search(r"private", t.get("service", "")):
        return False
    return True


def bbox(zone: str) -> tuple[float, float, float, float]:
    """(west, south, east, north)"""
    _, _, (lat, lon), half = ZONES[zone]
    dlat = half / 111_320
    dlon = half / (111_320 * math.cos(math.radians(lat)))
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat


def inside(b, lon, lat) -> bool:
    return b[0] <= lon <= b[2] and b[1] <= lat <= b[3]


def stop_kind(t: dict) -> str | None:
    if t.get("highway") == "bus_stop":
        return "BUS"
    if t.get("railway") in ("station", "halt"):
        if t.get("station") in ("subway", "light_rail") or t.get("subway") == "yes" or t.get("light_rail") == "yes":
            return "SUBWAY"
        return "RAIL"
    return None


def stop_feature(osm_id: str, lon: float, lat: float, t: dict, kind: str) -> dict:
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
            "properties": {"osm_id": osm_id, "kind": kind, "name": t.get("name:ko") or t.get("name"),
                           "name_en": t.get("name:en"), "ref": t.get("ref") or t.get("local_ref"),
                           "operator": t.get("operator"), "network": t.get("network")}}


def extract_from_pbf(pbf: Path, zones: list[str]):
    import osmium

    boxes = {z: bbox(z) for z in zones}
    ways = {z: [] for z in zones}
    stops = {z: [] for z in zones}

    class H(osmium.SimpleHandler):
        def node(self, n):
            if not n.tags:
                return
            t = {k: v for k, v in n.tags}
            kind = stop_kind(t)
            if kind and n.location.valid():
                for z, b in boxes.items():
                    if inside(b, n.location.lon, n.location.lat):
                        stops[z].append(stop_feature(f"node/{n.id}", n.location.lon, n.location.lat, t, kind))

        def way(self, w):
            t = {k: v for k, v in w.tags}
            is_walk = walk_ok(t)
            kind = stop_kind(t)
            if not is_walk and not kind:
                return
            pts = [(nd.ref, nd.lon, nd.lat) for nd in w.nodes if nd.location.valid()]
            if not pts:
                return
            for z, b in boxes.items():
                if any(inside(b, lon, lat) for _, lon, lat in pts):
                    if is_walk:
                        ways[z].append((w.id, pts, t))
                    elif kind:  # station mapped as an area: use the mean of its outline
                        lon = sum(p[1] for p in pts) / len(pts)
                        lat = sum(p[2] for p in pts) / len(pts)
                        stops[z].append(stop_feature(f"way/{w.id}", lon, lat, t, kind))

    H().apply_file(str(pbf), locations=True, idx="flex_mem")
    header = osmium.io.Reader(str(pbf), osmium.osm.osm_entity_bits.NOTHING)
    ts = header.header().get("osmosis_replication_timestamp")
    header.close()
    return ways, stops, ts


def write_xml(path: Path, ways: list) -> None:
    nodes: dict[int, tuple[float, float]] = {}
    for _, pts, _ in ways:
        for ref, lon, lat in pts:
            nodes[ref] = (lon, lat)
    with path.open("w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="ourtrip">\n')
        for ref, (lon, lat) in nodes.items():
            f.write(f'<node id="{ref}" lat="{lat:.7f}" lon="{lon:.7f}"/>\n')
        for wid, pts, tags in ways:
            f.write(f'<way id="{wid}">')
            f.write("".join(f'<nd ref="{ref}"/>' for ref, _, _ in pts))
            f.write("".join(f"<tag k={quoteattr(k)} v={quoteattr(v)}/>" for k, v in tags.items()))
            f.write("</way>\n")
        f.write("</osm>\n")


def finish(zone: str, G, feats: list, source: str, data_ts: str | None, t0: float) -> dict:
    city, label, centre, dist = ZONES[zone]
    ox.save_graphml(G, OUT / f"{zone}.graphml")
    uniq = {f["properties"]["osm_id"]: f for f in feats}
    (OUT / f"{zone}_stops.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": list(uniq.values())}, ensure_ascii=False), encoding="utf-8")
    info = {"zone": zone, "city": city, "label": label, "centre": centre, "half_size_m": dist,
            "nodes": G.number_of_nodes(), "edges": G.number_of_edges(), "stops": len(uniq),
            "source": source, "osm_data_timestamp": data_ts,
            "built_at": datetime.now(timezone.utc).isoformat(), "seconds": round(time.time() - t0, 1)}
    print(json.dumps(info, ensure_ascii=False), flush=True)
    return info


def build_pbf(pbf: Path, zones: list[str]) -> dict:
    t0 = time.time()
    print(f"scanning {pbf.name} for {len(zones)} zones …", flush=True)
    ways, stops, ts = extract_from_pbf(pbf, zones)
    print(f"scan done in {time.time() - t0:.0f}s (OSM data timestamp {ts})", flush=True)
    WORK.mkdir(exist_ok=True)
    out = {}
    for z in zones:
        t1 = time.time()
        xml = WORK / f"{z}.osm"
        write_xml(xml, ways[z])
        G = ox.graph_from_xml(xml, bidirectional=True, simplify=True, retain_all=True)
        w, s, e, n = bbox(z)
        G = ox.truncate.truncate_graph_bbox(G, (w, s, e, n))
        G = ox.truncate.largest_component(G, strongly=False)
        out[z] = finish(z, G, stops[z], f"Geofabrik {pbf.name} → osmnx.graph_from_xml (walk filter)", ts, t1)
    return out


def build_overpass(zones: list[str]) -> dict:
    out = {}
    for z in zones:
        _, _, centre, dist = ZONES[z]
        t0 = time.time()
        G = ox.graph_from_point(centre, dist=dist, dist_type="bbox", network_type="walk", simplify=True)
        feats = []
        try:
            gdf = ox.features_from_point(centre, tags={"highway": "bus_stop", "railway": ["station", "halt"]}, dist=dist)
            for (etype, oid), row in gdf.iterrows():
                t = {k: v for k, v in row.items() if k != "geometry" and isinstance(v, str)}
                kind = stop_kind(t)
                if kind:
                    c = row.geometry.centroid
                    feats.append(stop_feature(f"{etype}/{oid}", c.x, c.y, t, kind))
        except Exception as exc:
            print(f"  stops failed for {z}: {exc}")
        out[z] = finish(z, G, feats, "Overpass API → osmnx.graph_from_point(network_type='walk')", None, t0)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("zones", nargs="*")
    ap.add_argument("--pbf", type=Path)
    ap.add_argument("--overpass", action="store_true")
    a = ap.parse_args()
    zones = a.zones or list(ZONES)
    OUT.mkdir(parents=True, exist_ok=True)
    ox.settings.use_cache = True
    ox.settings.cache_folder = str(ROOT / ".osmnx_cache")
    ox.settings.requests_timeout = 600
    if a.pbf:
        built = build_pbf(a.pbf, zones)
    elif a.overpass:
        built = build_overpass(zones)
    else:
        ap.error("choose --pbf PATH or --overpass")
    mpath = OUT / "manifest.json"
    manifest = json.loads(mpath.read_text("utf-8")) if mpath.exists() else {"zones": {}}
    manifest["zones"].update(built)
    manifest.update({"osmnx_version": ox.__version__, "network_type": "walk",
                     "license": "ODbL 1.0 — © OpenStreetMap contributors"})
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
