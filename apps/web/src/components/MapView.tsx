import { useEffect, useRef } from "react";
import maplibregl, { type Map as MLMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// OpenStreetMap standard raster tiles (openstreetmap.org "Standard" layer) — 2D only, no key.
// Usage policy: https://operations.osmfoundation.org/policies/tiles/ (attribution required, light traffic).
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

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
  WALK: "#3182F6", BUS: "#E8833A", SUBWAY: "#7B5CC4", TRAIN: "#333D4B", EXPRESS_BUS: "#E8833A", INTERCITY_BUS: "#E8833A",
};

/** double-tap window: a tap counts as "pick this spot" only if nothing follows it within this time */
const TAP_MS = 280;

export default function MapView({
  markers, routes = [], fit, fitKey, routeFit, focus, center = [129.07, 35.15], zoom = 11, onSelect, onPick, onUserMove, showLocate = true, className = "", bottomPad = 220,
}: {
  markers: MapMarker[]; routes?: RouteFeature[]; center?: [number, number]; zoom?: number;
  /** [lat, lon] points to frame when `fit` itself or `fitKey` changes (bump fitKey to frame the same points again) */
  fit?: [number, number][] | null; fitKey?: number;
  /** framed when a route appears; clearing it leaves the view where the user put it */
  routeFit?: [number, number][] | null;
  focus?: { lat: number; lon: number; zoom?: number; key: string } | null; bottomPad?: number;
  onSelect?: (id: string, kind: MapMarker["kind"]) => void; onPick?: (lat: number, lon: number) => void;
  /** the user started dragging the map by hand */
  onUserMove?: () => void;
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
  const moveRef = useRef(onUserMove);
  moveRef.current = onUserMove;
  // whichever camera move came last wins, also while the style is still loading
  const pending = useRef<(() => void) | null>(null);
  const whenReady = (go: () => void) => { if (loaded.current) go(); else pending.current = go; };

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current, style: STYLE, minZoom: 5, maxZoom: 19, center, zoom, maxPitch: 0, pitchWithRotate: false,
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
      pending.current?.();
      pending.current = null;
      m.fire("ourtrip:ready");
    });
    // A tap picks a spot, but only once we know it isn't a double-tap zoom or the start of a drag.
    let tapTimer: number | undefined;
    let lastTap = -Infinity;
    let lastGesture = -Infinity;
    const cancelTap = () => window.clearTimeout(tapTimer);
    m.on("click", (e) => {
      const now = performance.now();
      const repeated = now - lastTap < TAP_MS || now - lastGesture < TAP_MS;
      lastTap = now;
      cancelTap();
      if (repeated) return;
      tapTimer = window.setTimeout(() => pickRef.current?.(e.lngLat.lat, e.lngLat.lng), TAP_MS);
    });
    const onGesture = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return; // our own easeTo/fitBounds
      lastGesture = performance.now();
      cancelTap();
    };
    m.on("dragstart", (e) => { onGesture(e); if (e.originalEvent) moveRef.current?.(); });
    m.on("zoomstart", onGesture);
    map.current = m;
    (window as unknown as { __otMap?: MLMap }).__otMap = m; // for pin-accuracy checks (E2E)
    return () => { cancelTap(); m.remove(); map.current = null; loaded.current = false; };
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
        properties: { mode: r.mode, color: r.color || ROUTE_COLOR[r.mode] || "#8B95A1" },
      })) });
    };
    if (loaded.current) apply(); else m.once("ourtrip:ready", apply);
  }, [routes]);

  // Screen space covered by the search bar (top) and cards/sheet (bottom), capped so there is always room left to fit into.
  // Never pass `padding` to easeTo: MapLibre keeps it on the map and adds it to every later fitBounds.
  const covered = (m: MLMap) => {
    const h = m.getContainer().clientHeight;
    return { top: Math.min(120, h * 0.2), bottom: Math.min(bottomPad, h * 0.6) };
  };
  const easeToPoint = (m: MLMap, lat: number, lon: number, zoom: number) => {
    const { top, bottom } = covered(m);
    m.easeTo({ center: [lon, lat], zoom, offset: [0, (top - bottom) / 2], duration: 600 });
  };
  const frame = (pts?: [number, number][] | null) => {
    const m = map.current;
    if (!m || !pts || pts.length === 0) return;
    whenReady(() => {
      if (pts.length === 1) { easeToPoint(m, pts[0][0], pts[0][1], Math.max(m.getZoom(), 15)); return; }
      const b = new maplibregl.LngLatBounds();
      pts.forEach(([lat, lon]) => b.extend([lon, lat]));
      m.fitBounds(b, { padding: { ...covered(m), left: 40, right: 40 }, maxZoom: 16, duration: 600 });
    });
  };
  useEffect(() => frame(fit), [fit, fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => frame(routeFit), [routeFit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m || !focus) return;
    whenReady(() => easeToPoint(m, focus.lat, focus.lon, Math.max(m.getZoom(), focus.zoom ?? 14.5)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  return <div ref={el} className={`w-full h-full ${className}`} />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
