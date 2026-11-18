import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import MapView, { type MapMarker } from "./MapView";
import { Sheet, InlineError } from "./ui";
import { api, qs } from "@/services/api";
import type { City } from "@/services/types";

export interface PickedLocation { lat: number; lon: number; source: "USER_PICKED" | "OSM_NOMINATIM"; osm_ref?: string | null; label?: string }

const CITY_CENTER: Record<City, [number, number]> = {
  busan: [129.07, 35.15], gyeongju: [129.215, 35.835], pohang: [129.37, 36.03], other: [128.0, 36.0],
};

interface GeoHit { name: string; display_name: string; lat: number; lon: number; osm_ref: string }

/** Coordinates come only from the user's tap on our OSM map or an OSM (Nominatim) search hit. */
export default function LocationPicker({ open, onClose, onPick, city, initial, query: initialQuery = "" }: {
  open: boolean; onClose: () => void; onPick: (p: PickedLocation) => void; city: City;
  initial?: { lat: number; lon: number } | null; query?: string;
}) {
  const [pick, setPick] = useState<PickedLocation | null>(initial ? { ...initial, source: "USER_PICKED" } : null);
  const [q, setQ] = useState(initialQuery);
  const search = useMutation({
    mutationFn: () => api.get<{ results: GeoHit[] }>(`/api/geocode/search?${qs({ q, city })}`),
  });
  const markers = useMemo<MapMarker[]>(() => pick ? [{ id: "pick", lat: pick.lat, lon: pick.lon, icon: "📍", color: "#EE6C4D", kind: "pick", label: pick.label }] : [], [pick]);
  const fit = useMemo<[number, number][] | null>(() => (pick ? [[pick.lat, pick.lon]] : null), [pick?.lat, pick?.lon]);

  return (
    <Sheet open={open} onClose={onClose} title="위치 지정" tall>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) search.mutate(); }}>
        <input className="field flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="OSM에서 장소 이름 검색" aria-label="장소 검색" />
        <button className="btn btn-ghost shrink-0" disabled={search.isPending}>검색</button>
      </form>
      <InlineError error={search.error} />
      {search.data && (
        <ul className="mt-2 max-h-36 overflow-y-auto card divide-y divide-line">
          {search.data.results.length === 0 && <li className="p-3 text-sm text-muted">검색 결과가 없어요. 지도를 눌러 직접 지정해 주세요.</li>}
          {search.data.results.map((h) => (
            <li key={h.osm_ref}>
              <button className="w-full text-left px-3 py-2 min-h-11" onClick={() => setPick({ lat: h.lat, lon: h.lon, source: "OSM_NOMINATIM", osm_ref: h.osm_ref, label: h.name })}>
                <span className="font-semibold text-sm">{h.name}</span>
                <span className="block text-xs text-muted truncate">{h.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted mt-2">지도를 눌러 핀을 놓거나 검색 결과를 고르세요. 검색은 OpenStreetMap Nominatim을 사용해요.</p>
      <div className="mt-2 h-[48dvh] rounded-2xl overflow-hidden border border-line">
        <MapView markers={markers} fit={fit} center={initial ? [initial.lon, initial.lat] : CITY_CENTER[city]} zoom={initial ? 15 : 12}
          onPick={(lat, lon) => setPick({ lat, lon, source: "USER_PICKED" })} showLocate />
      </div>
      <div className="mt-3 flex gap-2 items-center">
        <span className="flex-1 text-xs text-navy-soft">
          {pick ? `${pick.lat.toFixed(5)}, ${pick.lon.toFixed(5)} · ${pick.source === "OSM_NOMINATIM" ? "OSM 검색" : "직접 선택"}` : "아직 위치를 고르지 않았어요"}
        </span>
        <button className="btn btn-primary" disabled={!pick} onClick={() => { if (pick) { onPick(pick); onClose(); } }}>이 위치로</button>
      </div>
    </Sheet>
  );
}
