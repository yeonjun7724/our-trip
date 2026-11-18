import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import QuickAdd from "@/features/places/QuickAdd";
import MapView, { type MapMarker, type RouteFeature } from "@/components/MapView";
import { Sheet } from "@/components/ui";
import { CATEGORY_ICON, CATEGORY_LABEL, CITY_COLOR, CITY_LABEL } from "@/services/format";
import { useItinerary, usePlaces, useTripId } from "@/services/queries";
import type { City, Stop } from "@/services/types";
import { useMapUi } from "@/store/ui";
import PlaceDetail from "@/features/places/PlaceDetail";
import { useNearby } from "@/features/transit/NearbyStops";

const STOP_STYLE = { BUS: { icon: "🚌", color: "#E8833A" }, SUBWAY: { icon: "🚇", color: "#7B5CC4" }, RAIL: { icon: "🚆", color: "#1E2A44" } };

export default function MapPage() {
  const tripId = useTripId();
  const places = usePlaces(tripId);
  const it = useItinerary(tripId);
  const ui = useMapUi();
  const [params] = useSearchParams();
  const [routes, setRoutes] = useState<RouteFeature[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [quick, setQuick] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => { const p = params.get("place"); if (p) ui.set({ selectedPlaceId: p }); }, [params]); // eslint-disable-line

  const dayOf = useMemo(() => {
    const m: Record<string, { day: number; visited: boolean }> = {};
    it.data?.days.forEach((d) => d.entries.forEach((e) => { if (e.place_id) m[e.place_id] = { day: d.day_number, visited: e.visit_status === "VISITED" }; }));
    return m;
  }, [it.data]);

  const visible = useMemo(() => (places.data ?? []).filter((p) => {
    if (ui.city !== "all" && p.city !== ui.city) return false;
    if (ui.day !== "all" && dayOf[p.id]?.day !== ui.day) return false;
    if (ui.category !== "all" && p.category !== ui.category) return false;
    if (ui.creator === "me" && !p.created_by_me) return false;
    if (ui.creator === "partner" && (p.created_by_me || !p.created_by_id)) return false;
    if (ui.scheduled === "yes" && !dayOf[p.id]) return false;
    if (ui.scheduled === "no" && dayOf[p.id]) return false;
    if (ui.hideVisited && dayOf[p.id]?.visited) return false;
    return true;
  }), [places.data, ui, dayOf]);

  const selected = places.data?.find((p) => p.id === ui.selectedPlaceId) ?? null;
  const ambient = useNearby(center?.lat, center?.lon, 500, ui.showStops && !selected);

  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = visible.filter((p) => p.has_location).map((p) => ({
      id: p.id, lat: p.latitude!, lon: p.longitude!, label: p.name, icon: CATEGORY_ICON[p.category] ?? "📍",
      color: CITY_COLOR[p.city], kind: "place", selected: p.id === ui.selectedPlaceId, dim: dayOf[p.id]?.visited,
    }));
    const st = selected ? stops : ui.showStops ? ambient.data?.stops ?? [] : [];
    st.forEach((s) => m.push({ id: s.key, lat: s.lat, lon: s.lon, icon: STOP_STYLE[s.kind].icon, color: STOP_STYLE[s.kind].color, kind: "stop", label: s.name ?? "" }));
    if (quick) m.push({ id: "quick", lat: quick.lat, lon: quick.lon, icon: "＋", color: "#EE6C4D", kind: "pick", label: "여기에 추가" });
    return m;
  }, [visible, ui.selectedPlaceId, ui.showStops, stops, ambient.data, selected, dayOf, quick]);

  const fit = useMemo<[number, number][] | null>(() => {
    if (selected?.has_location && routes.length === 0) return [[selected.latitude!, selected.longitude!]];
    if (routes.length) return routes.flatMap((r) => r.geometry.coordinates.map(([x, y]) => [y, x] as [number, number]));
    const pts = visible.filter((p) => p.has_location).map((p) => [p.latitude!, p.longitude!] as [number, number]);
    return pts.length ? pts : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, routes, ui.city, ui.day, places.data?.length]);

  const noLoc = visible.filter((p) => !p.has_location).length;
  const activeFilters = [ui.day !== "all", ui.category !== "all", ui.creator !== "all", ui.scheduled !== "all", ui.hideVisited].filter(Boolean).length;

  return (
    <div className="fixed inset-0 bottom-[calc(var(--nav-h)+var(--sab))]">
      <MapView markers={markers} routes={routes} fit={fit}
        onSelect={(id, kind) => { if (kind === "place") { setRoutes([]); setStops([]); ui.set({ selectedPlaceId: id }); } }}
        onPick={(lat, lon) => {
          if (selected) return;
          if (ui.showStops) setCenter({ lat, lon }); else setQuick({ lat, lon });
        }} />

      {!quick && !selected && (
        <div className="absolute right-3 flex flex-col items-end gap-2" style={{ bottom: 16 }}>
          <span className="text-xs bg-paper/95 rounded-lg px-2 py-1 shadow-sm">{ui.showStops ? "지도를 눌러 주변 정류장 보기" : "지도를 눌러 장소 추가"}</span>
          <Link to="/places/new" className="btn btn-primary shadow-lg">🔗 링크로 추가</Link>
        </div>
      )}

      <div className="absolute top-0 inset-x-0 px-3 pt-[calc(var(--sat)+10px)] pointer-events-none">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pointer-events-auto pr-14">
          {(["all", "busan", "gyeongju", "pohang"] as (City | "all")[]).map((c) => (
            <button key={c} onClick={() => ui.set({ city: c })}
              className={`shrink-0 min-h-10 px-3.5 rounded-full text-sm font-semibold shadow-sm border ${ui.city === c ? "bg-navy text-white border-navy" : "bg-paper border-line"}`}>
              {c === "all" ? "전체" : CITY_LABEL[c]}
            </button>
          ))}
          <button onClick={() => setFiltersOpen(true)} className="shrink-0 min-h-10 px-3.5 rounded-full text-sm font-semibold shadow-sm border bg-paper border-line">
            필터{activeFilters ? ` ${activeFilters}` : ""}
          </button>
          <button onClick={() => { ui.set({ showStops: !ui.showStops }); setCenter(null); }}
            className={`shrink-0 min-h-10 px-3.5 rounded-full text-sm font-semibold shadow-sm border ${ui.showStops ? "bg-coral text-white border-coral" : "bg-paper border-line"}`}>
            🚏 주변 교통
          </button>
        </div>
        {ui.showStops && !selected && (
          <p className="mt-2 inline-block text-xs bg-paper/95 rounded-lg px-2 py-1 shadow-sm pointer-events-auto">
            {center ? (ambient.isFetching ? "정류장 찾는 중…" : `반경 500m 정류장 ${ambient.data?.stops.length ?? 0}곳`) : "지도를 눌러 주변 정류장을 찾아보세요"}
          </p>
        )}
        {noLoc > 0 && <p className="mt-2 inline-block text-xs bg-paper/95 rounded-lg px-2 py-1 shadow-sm pointer-events-auto ml-1">위치 미확정 {noLoc}곳은 지도에 없어요</p>}
        {routes.length > 0 && (
          <div className="mt-2 flex gap-1.5 pointer-events-auto">
            <span className="text-xs bg-paper/95 rounded-lg px-2 py-1 shadow-sm">
              <span className="text-sea font-bold">┅ 도보</span> <span className="text-[#E8833A] font-bold">━ 버스</span> <span className="text-[#7B5CC4] font-bold">━ 지하철</span>
            </span>
            <button className="text-xs bg-paper rounded-lg px-2 shadow-sm min-h-8" onClick={() => setRoutes([])}>경로 지우기</button>
          </div>
        )}
      </div>

      <Sheet open={!!selected} onClose={() => { ui.set({ selectedPlaceId: null }); setRoutes([]); setStops([]); }}
        title={selected && <span>{CATEGORY_ICON[selected.category]} {selected.name}</span>}>
        {selected && <PlaceDetail key={selected.id} place={selected} onRoute={setRoutes} onStops={setStops}
          onDeleted={() => ui.set({ selectedPlaceId: null })} />}
      </Sheet>

      <QuickAdd at={quick} onClose={() => setQuick(null)} onSaved={(id) => { setQuick(null); ui.set({ selectedPlaceId: id }); }} />

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="지도 필터">
        <div className="space-y-4">
          <FilterRow label="날짜" value={String(ui.day)} onChange={(v) => ui.set({ day: v === "all" ? "all" : Number(v) })}
            options={[["all", "전체"], ...(it.data?.days ?? []).map((d) => [String(d.day_number), `DAY ${d.day_number}`] as [string, string])]} />
          <FilterRow label="분류" value={ui.category} onChange={(v) => ui.set({ category: v })}
            options={[["all", "전체"], ...Object.entries(CATEGORY_LABEL)]} />
          <FilterRow label="등록자" value={ui.creator} onChange={(v) => ui.set({ creator: v as never })}
            options={[["all", "모두"], ["me", "내가"], ["partner", "상대가"]]} />
          <FilterRow label="일정" value={ui.scheduled} onChange={(v) => ui.set({ scheduled: v as never })}
            options={[["all", "모두"], ["yes", "배정됨"], ["no", "미배정"]]} />
          <label className="flex items-center gap-3 min-h-11">
            <input type="checkbox" className="w-5 h-5 accent-coral" checked={ui.hideVisited} onChange={(e) => ui.set({ hideVisited: e.target.checked })} />
            방문 완료한 곳 숨기기
          </label>
          <button className="btn btn-ghost w-full" onClick={() => ui.set({ day: "all", category: "all", creator: "all", scheduled: "all", hideVisited: false })}>초기화</button>
        </div>
      </Sheet>
    </div>
  );
}

function FilterRow({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)}
            className={`min-h-10 px-3 rounded-full text-sm font-semibold border ${value === v ? "bg-navy text-white border-navy" : "bg-paper border-line"}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}
