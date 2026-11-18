import { useEffect, useRef } from "react";
import maplibregl, { type Map as MLMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// OpenFreeMap vector tiles (OpenMapTiles schema, OSM data) — free, no key. 2D only.
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export interface MapMarker {
  id: string; lat: number; lon: number; label?: string; icon: string; color: string;
  kind: "place" | "stop" | "pick" | "station"; dim?: boolean; selected?: boolean;
}
export interface RouteFeature {
  geometry: { type: "LineString"; coordinates: number[][] };
  mode: string; color?: string | null;
}

const ROUTE_COLOR: Record<string, string> = {
  WALK: "#2F6FDE", BUS: "#E8833A", SUBWAY: "#7B5CC4", TRAIN: "#1E2A44", EXPRESS_BUS: "#E8833A", INTERCITY_BUS: "#E8833A",
};

function strip3D(map: MLMap) {
  const style = map.getStyle();
  style.layers?.forEach((l) => {
    if (l.type === "fill-extrusion" || l.type === "hillshade" || (l as { id: string }).id.includes("3d")) {
      map.removeLayer(l.id);
    }
  });
  map.setTerrain(null);
}

export default function MapView({
  markers, routes = [], fit, center = [129.07, 35.15], zoom = 11, onSelect, onPick, showLocate = true, className = "",
}: {
  markers: MapMarker[]; routes?: RouteFeature[]; fit?: [number, number][] | null; center?: [number, number]; zoom?: number;
  onSelect?: (id: string, kind: MapMarker["kind"]) => void; onPick?: (lat: number, lon: number) => void;
  showLocate?: boolean; className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const loaded = useRef(false);
  const markerObjs = useRef<Marker[]>([]);
  const pickRef = useRef(onPick);
  const selRef = useRef(onSelect);
  pickRef.current = onPick;
  selRef.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current, style: STYLE_URL, center, zoom, maxPitch: 0, pitchWithRotate: false,
      dragRotate: false, attributionControl: { compact: true },
    });
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    if (showLocate) {
      m.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");
    }
    m.on("load", () => {
      strip3D(m);
      m.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "route-casing", type: "line", source: "routes", filter: ["!=", ["get", "mode"], "WALK"],
        paint: { "line-color": "#ffffff", "line-width": ["case", ["==", ["get", "mode"], "TRAIN"], 9, 7] },
        layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "route-line", type: "line", source: "routes", filter: ["!=", ["get", "mode"], "WALK"],
        paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "mode"], "TRAIN"], 6, 4.5] },
        layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "route-walk", type: "line", source: "routes", filter: ["==", ["get", "mode"], "WALK"],
        paint: { "line-color": ROUTE_COLOR.WALK, "line-width": 4, "line-dasharray": [1.2, 1.4] },
        layout: { "line-cap": "round", "line-join": "round" } });
      loaded.current = true;
      m.fire("ourtrip:ready");
    });
    m.on("click", (e) => pickRef.current?.(e.lngLat.lat, e.lngLat.lng));
    map.current = m;
    return () => { m.remove(); map.current = null; loaded.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // markers (HTML so Korean labels/emoji always render)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markerObjs.current.forEach((mk) => mk.remove());
    markerObjs.current = markers.map((mk) => {
      const node = document.createElement("button");
      node.type = "button";
      node.setAttribute("aria-label", mk.label ?? mk.kind);
      const size = mk.kind === "stop" ? 26 : mk.kind === "pick" ? 34 : 34;
      node.style.cssText = `display:flex;flex-direction:column;align-items:center;background:none;border:0;padding:0;cursor:pointer;opacity:${mk.dim ? 0.45 : 1};`;
      node.innerHTML = `<span style="width:${size}px;height:${size}px;border-radius:9999px;display:flex;align-items:center;justify-content:center;
        background:${mk.kind === "stop" ? "#fff" : mk.color};color:#fff;border:${mk.kind === "stop" ? `2px solid ${mk.color}` : "2px solid #fff"};
        box-shadow:0 1px 4px rgba(30,42,68,.35);font-size:${mk.kind === "stop" ? 13 : 16}px;${mk.selected ? "outline:3px solid #EE6C4D;outline-offset:1px;" : ""}">${mk.icon}</span>
        ${mk.label && mk.kind !== "stop" ? `<span style="margin-top:2px;max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:700;color:#1E2A44;background:rgba(255,255,255,.9);padding:0 4px;border-radius:6px">${escapeHtml(mk.label)}</span>` : ""}`;
      node.addEventListener("click", (ev) => { ev.stopPropagation(); selRef.current?.(mk.id, mk.kind); });
      const marker = new maplibregl.Marker({ element: node, anchor: mk.kind === "stop" ? "center" : "top", offset: mk.kind === "stop" ? [0, 0] : [0, -17] })
        .setLngLat([mk.lon, mk.lat]).addTo(m);
      // MapLibre replaces aria-label with a generic "Map marker"; restore the place/stop name
      marker.getElement().setAttribute("aria-label", mk.label || (mk.kind === "stop" ? "정류장" : "장소"));
      return marker;
    });
  }, [markers]);

  // routes
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const src = m.getSource("routes") as maplibregl.GeoJSONSource | undefined;
      src?.setData({ type: "FeatureCollection", features: routes.map((r) => ({
        type: "Feature", geometry: r.geometry,
        // provider colour only when the provider supplied one; otherwise a generic mode colour
        properties: { mode: r.mode, color: r.color || ROUTE_COLOR[r.mode] || "#7D8597" },
      })) });
    };
    if (loaded.current) apply(); else m.once("ourtrip:ready", apply);
  }, [routes]);

  useEffect(() => {
    const m = map.current;
    if (!m || !fit || fit.length === 0) return;
    const go = () => {
      if (fit.length === 1) { m.easeTo({ center: [fit[0][1], fit[0][0]], zoom: Math.max(m.getZoom(), 15) }); return; }
      const b = new maplibregl.LngLatBounds();
      fit.forEach(([lat, lon]) => b.extend([lon, lat]));
      m.fitBounds(b, { padding: { top: 60, bottom: 220, left: 40, right: 40 }, maxZoom: 16, duration: 500 });
    };
    if (loaded.current) go(); else m.once("ourtrip:ready", go);
  }, [fit]);

  return <div ref={el} className={`w-full h-full ${className}`} />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
