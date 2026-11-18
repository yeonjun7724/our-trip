import { useEffect, useRef } from "react";
import maplibregl, { type Map as MLMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// OpenFreeMap vector tiles (OpenMapTiles schema, OSM data) — free, no key. 2D only.
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export interface MapMarker {
  id: string; lat: number; lon: number; label?: string; icon: string; color: string;
  kind: "place" | "stop" | "pick" | "station"; dim?: boolean; selected?: boolean;
  badge?: string | null; heart?: boolean; done?: boolean;
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
  theme(map);
}

/** Warm brand palette on top of the neutral Positron style (paint-only; data unchanged). */
function theme(map: MLMap) {
  const set = (id: string, prop: string, v: unknown) => { try { map.setPaintProperty(id, prop, v); } catch { /* layer lacks prop */ } };
  for (const l of map.getStyle().layers ?? []) {
    const id = l.id.toLowerCase();
    if (l.type === "background") set(l.id, "background-color", "#F7F2EA");
    else if (l.type === "fill" && /water|ocean|sea|lake|river/.test(id)) set(l.id, "fill-color", "#C9E2F2");
    else if (l.type === "line" && /water|river|stream|canal/.test(id)) set(l.id, "line-color", "#A9CDE6");
    else if (l.type === "fill" && /park|wood|forest|grass|landcover|scrub|cemetery|garden/.test(id)) set(l.id, "fill-color", "#DCEBD2");
    else if (l.type === "fill" && /building/.test(id)) set(l.id, "fill-color", "#ECE3D5");
    else if (l.type === "fill" && /landuse|residential/.test(id)) set(l.id, "fill-color", "#F1EBE0");
    else if (l.type === "line" && /motorway|trunk|primary/.test(id) && !/casing/.test(id)) set(l.id, "line-color", "#FBE7C6");
    else if (l.type === "symbol" && /place|label|name/.test(id)) { set(l.id, "text-color", "#3E4A63"); set(l.id, "text-halo-color", "#FBF7F0"); }
  }
}

export default function MapView({
  markers, routes = [], fit, focus, center = [129.07, 35.15], zoom = 11, onSelect, onPick, showLocate = true, className = "", bottomPad = 220,
}: {
  markers: MapMarker[]; routes?: RouteFeature[]; fit?: [number, number][] | null; center?: [number, number]; zoom?: number;
  focus?: { lat: number; lon: number; zoom?: number; key: string } | null; bottomPad?: number;
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
    // style.load fires as soon as the style is parsed — "load" would wait for the first tiles (slow on mobile networks)
    m.once("style.load", () => {
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
      const zoomClass = () => m.getContainer().classList.toggle("z-lo", m.getZoom() < 12.8);
      m.on("zoom", zoomClass);
      zoomClass();
      loaded.current = true;
      m.fire("ourtrip:ready");
    });
    m.on("click", (e) => pickRef.current?.(e.lngLat.lat, e.lngLat.lng));
    map.current = m;
    (window as unknown as { __otMap?: MLMap }).__otMap = m; // for pin-accuracy checks (E2E)
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
      if (mk.kind === "stop") {
        node.className = "ot-stop";
        node.style.color = mk.color;
        node.textContent = mk.icon;
      } else {
        node.className = `ot-pin${mk.selected ? " sel" : ""}${mk.done ? " done" : ""}${mk.kind === "pick" ? " pop" : ""}`;
        node.style.opacity = mk.dim ? "0.45" : "1";
        // Teardrop pin drawn as SVG; its tip is at the bottom-centre of .pinbox, which is the anchor point.
        node.innerHTML = `<span class="pinbox">`
          + `<svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 43C17 43 2.5 27.5 2.5 16.5a14.5 14.5 0 0 1 29 0C31.5 27.5 17 43 17 43z" fill="${mk.color}" stroke="#fff" stroke-width="2.5"/></svg>`
          + `<span class="ico">${mk.icon}</span>`
          + (mk.done ? `<span class="badge" style="background:#2E8B57">✓</span>` : mk.badge ? `<span class="badge">${escapeHtml(mk.badge)}</span>` : "")
          + (mk.heart ? `<span class="heart">💕</span>` : "")
          + `<span class="tip" data-tip></span>`
          + (mk.label ? `<span class="lbl">${escapeHtml(mk.label)}</span>` : "")
          + `</span>`;
        if (mk.selected) node.style.zIndex = "5";
      }
      node.addEventListener("click", (ev) => { ev.stopPropagation(); selRef.current?.(mk.id, mk.kind); });
      const marker = new maplibregl.Marker({ element: node, anchor: mk.kind === "stop" ? "center" : "bottom" })
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
      m.fitBounds(b, { padding: { top: 120, bottom: bottomPad, left: 40, right: 40 }, maxZoom: 16, duration: 600 });
    };
    if (loaded.current) go(); else m.once("ourtrip:ready", go);
  }, [fit]);

  useEffect(() => {
    const m = map.current;
    if (!m || !focus) return;
    const go = () => m.easeTo({ center: [focus.lon, focus.lat], zoom: Math.max(m.getZoom(), focus.zoom ?? 14.5),
      padding: { top: 100, bottom: bottomPad, left: 0, right: 0 }, duration: 650 });
    if (loaded.current) go(); else m.once("ourtrip:ready", go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  return <div ref={el} className={`w-full h-full ${className}`} />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
