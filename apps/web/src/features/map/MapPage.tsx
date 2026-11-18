import HelpButton from "@/components/Help";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import MapView, { type MapMarker, type RouteFeature } from "@/components/MapView";
import Icon from "@/components/Icon";
import { Avatar, Sheet } from "@/components/ui";
import { api, qs } from "@/services/api";
import { CATEGORY_ICON, CATEGORY_LABEL, CITY_COLOR, CITY_LABEL, PREF_SHORT } from "@/services/format";
import { useItinerary, usePlaces, useTrip, useTripId } from "@/services/queries";
import type { City, Place, Stop } from "@/services/types";
import { useMapUi } from "@/store/ui";
import PlaceDetail, { PlaceTitle } from "@/features/places/PlaceDetail";
import QuickAdd, { type QuickAddInit } from "@/features/places/QuickAdd";
import { useNearby } from "@/features/transit/NearbyStops";

const STOP_STYLE = { BUS: { icon: "🚌", color: "#E8833A" }, SUBWAY: { icon: "🚇", color: "#7B5CC4" }, RAIL: { icon: "🚆", color: "#333D4B" } };
const PREF_EMOJI = { MUST: "😍", GOOD: "🙂", MAYBE: "🤔", SKIP: "🙅" } as const;

interface GeoHit { name: string; display_name: string; lat: number; lon: number; osm_ref: string }

export default function MapPage() {
  const tripId = useTripId();
  const places = usePlaces(tripId);
  const it = useItinerary(tripId);
  const trip = useTrip(tripId).data;
  const ui = useMapUi();
  const [params] = useSearchParams();
  const [routes, setRoutes] = useState<RouteFeature[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [autoWalk, setAutoWalk] = useState(false);
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [quick, setQuick] = useState<QuickAddInit | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; zoom?: number; key: string } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const carousel = useRef<HTMLDivElement>(null);

  useEffect(() => { const p = params.get("place"); if (p) { ui.set({ selectedPlaceId: p }); setDetailOpen(true); } }, [params]); // eslint-disable-line

  const memberIdx = useMemo(() => Object.fromEntries((trip?.members ?? []).map((m, i) => [m.id, i])), [trip]);

  const order = useMemo(() => {
    const m: Record<string, { day: number; n: number; visited: boolean }> = {};
    it.data?.days.forEach((d) => {
      let n = 0;
      d.entries.forEach((e) => { if (e.place_id) { n += 1; m[e.place_id] = { day: d.day_number, n, visited: e.visit_status === "VISITED" }; } });
    });
    return m;
  }, [it.data]);

  const visible = useMemo(() => (places.data ?? []).filter((p) => {
    if (ui.city !== "all" && p.city !== ui.city) return false;
    if (ui.day !== "all" && order[p.id]?.day !== ui.day) return false;
    if (ui.category !== "all" && p.category !== ui.category) return false;
    if (ui.creator === "me" && !p.created_by_me) return false;
    if (ui.creator === "partner" && (p.created_by_me || !p.created_by_id)) return false;
    if (ui.scheduled === "yes" && !order[p.id]) return false;
    if (ui.scheduled === "no" && order[p.id]) return false;
    if (ui.hideVisited && order[p.id]?.visited) return false;
    return true;
  }).sort((a, b) => ui.day !== "all"
    ? (order[a.id]?.n ?? 99) - (order[b.id]?.n ?? 99)
    : Number(b.both_want) - Number(a.both_want) || b.priority_score - a.priority_score), [places.data, ui, order]);

  const selected = places.data?.find((p) => p.id === ui.selectedPlaceId) ?? null;
  const dayObj = ui.day !== "all" ? it.data?.days.find((d) => d.day_number === ui.day) : undefined;
  const dayGeo = useQuery({
    queryKey: ["daygeo", tripId, dayObj?.id, dayObj?.version],
    queryFn: () => api.get<{ features: { geometry: RouteFeature["geometry"] }[]; skipped: { from: string; to: string }[]; walk_distance_m: number }>(
      `/api/trips/${tripId}/days/${dayObj!.id}/walk-geometry`),
    enabled: !!dayObj, staleTime: 60_000,
  });
  const dayRoutes = useMemo<RouteFeature[]>(() => (dayGeo.data?.features ?? []).map((f) => ({ geometry: f.geometry, mode: "WALK" })), [dayGeo.data]);
  const ambient = useNearby(center?.lat, center?.lon, 500, ui.showStops && !detailOpen);

  const select = (p: Place, open = false) => {
    ui.set({ selectedPlaceId: p.id });
    setRoutes([]); setStops([]);
    if (p.has_location) setFocus({ lat: p.latitude!, lon: p.longitude!, key: `${p.id}:${Date.now()}` });
    if (open) setDetailOpen(true);
  };

  useEffect(() => {
    if (!selected || !carousel.current) return;
    carousel.current.querySelector(`[data-card="${selected.id}"]`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }, [selected?.id]); // eslint-disable-line

  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = visible.filter((p) => p.has_location).map((p) => ({
      id: p.id, lat: p.latitude!, lon: p.longitude!, label: p.name, icon: CATEGORY_ICON[p.category] ?? "📍",
      color: CITY_COLOR[p.city], kind: "place", selected: p.id === ui.selectedPlaceId,
      badge: order[p.id] ? (ui.day !== "all" ? String(order[p.id].n) : `${order[p.id].day}·${order[p.id].n}`) : null,
      heart: p.both_want, done: order[p.id]?.visited,
    }));
    const st = detailOpen ? stops : ui.showStops ? ambient.data?.stops ?? [] : [];
    st.forEach((s) => m.push({ id: s.key, lat: s.lat, lon: s.lon, icon: STOP_STYLE[s.kind].icon, color: STOP_STYLE[s.kind].color, kind: "stop", label: s.name ?? "" }));
    if (quick) m.push({ id: "quick", lat: quick.lat, lon: quick.lon, icon: "＋", color: "#F04452", kind: "pick", label: quick.name || "여기에 추가" });
    return m;
  }, [visible, ui.selectedPlaceId, ui.showStops, ui.day, stops, ambient.data, detailOpen, order, quick]);

  const fit = useMemo<[number, number][] | null>(() => {
    if (routes.length) return routes.flatMap((r) => r.geometry.coordinates.map(([x, y]) => [y, x] as [number, number]));
    const pts = visible.filter((p) => p.has_location).map((p) => [p.latitude!, p.longitude!] as [number, number]);
    return pts.length ? pts : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, ui.city, ui.day, places.data?.length]);

  const geo = useMutation({ mutationFn: (text: string) => api.get<{ results: GeoHit[] }>(`/api/geocode/search?${qs({ q: text, city: ui.city === "all" ? undefined : ui.city })}`) });
  const matches = q.trim() ? (places.data ?? []).filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];
  const days = it.data?.days ?? [];
  const noLoc = visible.filter((p) => !p.has_location).length;
  const activeFilters = [ui.category !== "all", ui.creator !== "all", ui.scheduled !== "all", ui.hideVisited].filter(Boolean).length;
  const cardsVisible = !detailOpen && !quick && !searchOpen;

  return (
    <div className={`fixed inset-0 map-under-nav ${cardsVisible ? "" : "sheet-open"}`}>
      <MapView markers={markers} routes={routes.length ? routes : dayRoutes} fit={fit} focus={focus} bottomPad={detailOpen ? 420 : 310}
        onSelect={(id, kind) => {
          if (kind === "place") { const p = places.data?.find((x) => x.id === id); if (p) select(p, detailOpen || p.id === ui.selectedPlaceId); }
          if (kind === "pick") setQuick((x) => x);
        }}
        onPick={(lat, lon) => {
          if (searchOpen) { setSearchOpen(false); return; }
          if (detailOpen) return;
          if (ui.showStops) setCenter({ lat, lon });
          else { ui.set({ selectedPlaceId: null }); setQuick({ lat, lon }); }
        }} />

      {/* top: search + chips */}
      <div className="absolute top-0 inset-x-0 px-3 pt-[calc(var(--sat)+10px)] pointer-events-none z-10">
        <div className="flex gap-2 pointer-events-auto max-w-[640px] mx-auto">
          <div className="flex-1 min-w-0 relative">
            <div className="glass shadow-float rounded-[18px] flex items-center gap-2.5 px-4 h-[52px]">
              <Icon name="search" className="text-coral shrink-0" stroke={2.4} />
              <input className="flex-1 bg-transparent outline-none min-w-0 text-[16px]" placeholder="어디로 가고 싶어요?" value={q}
                onFocus={() => setSearchOpen(true)} onChange={(e) => { setQ(e.target.value); setSearchOpen(true); geo.reset(); }} aria-label="장소 검색" />
              {q && <button className="tap -mr-2 flex items-center justify-center text-muted" aria-label="지우기" onClick={() => { setQ(""); geo.reset(); }}><Icon name="x" size={18} /></button>}
            </div>
            {searchOpen && q.trim() && (
              <div className="absolute left-0 right-0 mt-2 card !rounded-[20px] shadow-float overflow-hidden py-1.5 max-h-[55dvh] overflow-y-auto fade-in">
                {matches.length > 0 && <p className="px-4 pt-2 pb-1 text-[13px] font-medium text-muted">우리 장소</p>}
                {matches.map((p) => (
                  <button key={p.id} className="w-full text-left px-4 min-h-14 flex items-center gap-3 active:bg-sand"
                    onClick={() => { setSearchOpen(false); setQ(""); select(p, true); }}>
                    <span className="w-10 h-10 rounded-full bg-sand flex items-center justify-center text-lg shrink-0">{CATEGORY_ICON[p.category]}</span>
                    <span className="flex-1 min-w-0"><b className="block truncate">{p.name}</b><span className="text-xs text-muted">{p.city_label}{order[p.id] ? ` · DAY ${order[p.id].day}` : ""}</span></span>
                  </button>
                ))}
                <button className="w-full text-left px-4 min-h-14 flex items-center gap-3 text-coral font-semibold active:bg-sand"
                  disabled={q.trim().length < 2 || geo.isPending} onClick={() => geo.mutate(q.trim())}>
                  <Icon name="map" /> {geo.isPending ? "찾는 중…" : `지도에서 '${q.trim()}' 찾아 추가하기`}
                </button>
                {geo.error && <p className="px-3 pb-2 text-sm text-bad">검색에 실패했어요. 지도를 직접 눌러 추가할 수 있어요.</p>}
                {geo.data?.results.length === 0 && <p className="px-3 pb-3 text-sm text-muted">OSM에서 찾지 못했어요. 지도를 직접 눌러 추가해 주세요.</p>}
                {geo.data?.results.map((h) => (
                  <button key={h.osm_ref} className="w-full text-left px-4 py-2.5 min-h-14 active:bg-sand"
                    onClick={() => { setSearchOpen(false); setFocus({ lat: h.lat, lon: h.lon, zoom: 16, key: h.osm_ref });
                      setQuick({ lat: h.lat, lon: h.lon, name: h.name, source: "OSM_NOMINATIM", osm_ref: h.osm_ref }); setQ(""); }}>
                    <b className="text-sm">{h.name}</b><span className="block text-xs text-muted truncate">{h.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="glass shadow-float rounded-[18px] w-[52px] h-[52px] flex items-center justify-center shrink-0"><HelpButton page="map" /></div>
          <Link to="/home" className="glass shadow-float rounded-[18px] w-[52px] h-[52px] flex items-center justify-center shrink-0" aria-label="여행 요약">
            {trip?.members.find((m) => m.is_me) ? <Avatar name={trip.members.find((m) => m.is_me)!.nickname} index={memberIdx[trip.members.find((m) => m.is_me)!.id]} size={30} /> : <Icon name="home" />}
          </Link>
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pointer-events-auto mt-2 max-w-[640px] mx-auto pb-1">
          {(["all", "busan", "gyeongju", "pohang"] as (City | "all")[]).map((c) => (
            <Chip key={c} on={ui.city === c} onClick={() => ui.set({ city: c, day: "all" })}
              dot={c === "all" ? undefined : CITY_COLOR[c]}>{c === "all" ? "전체" : CITY_LABEL[c]}</Chip>
          ))}
          <span className="w-px bg-line mx-0.5 my-1.5 shrink-0" />
          {days.map((d) => (
            <Chip key={d.id} on={ui.day === d.day_number} onClick={() => ui.set({ day: ui.day === d.day_number ? "all" : d.day_number, city: "all" })}>
              DAY {d.day_number}
            </Chip>
          ))}
          <Chip on={activeFilters > 0} onClick={() => setFiltersOpen(true)}><Icon name="filter" size={15} /> 필터{activeFilters ? ` ${activeFilters}` : ""}</Chip>
          <Chip on={ui.showStops} onClick={() => { ui.set({ showStops: !ui.showStops }); setCenter(null); }}><Icon name="bus" size={15} /> 주변 교통</Chip>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1.5 max-w-[640px] mx-auto">
          {ui.showStops && !detailOpen && (
            <Pill>{center ? (ambient.isFetching ? "정류장 찾는 중…" : `반경 500m 정류장 ${ambient.data?.stops.length ?? 0}곳`) : "지도를 누르면 그 주변 정류장을 보여줘요"}</Pill>
          )}
          {dayObj && dayGeo.data && (
            <Pill>🚶 DAY {dayObj.day_number} 도보 동선 {dayGeo.data.walk_distance_m >= 1000 ? `${(dayGeo.data.walk_distance_m / 1000).toFixed(1)}km` : `${dayGeo.data.walk_distance_m}m`}
              {dayGeo.data.skipped.length ? ` · 대중교통 구간 ${dayGeo.data.skipped.length}` : ""}</Pill>
          )}
          {noLoc > 0 && <Pill>위치 미정 {noLoc}곳은 지도에 없어요</Pill>}
          {routes.length > 0 && (
            <span className="pointer-events-auto bg-paper shadow-float rounded-full px-3.5 py-1.5 text-[13px] flex items-center gap-2">
              <span className="text-sea font-bold">┅ 도보</span><span className="text-[#E8833A] font-bold">━ 버스</span><span className="text-[#7B5CC4] font-bold">━ 지하철</span>
              <button className="font-semibold text-coral" onClick={() => setRoutes([])}>지우기</button>
            </span>
          )}
        </div>
      </div>

      {/* bottom: synced place cards */}
      {cardsVisible && (
        <div className="absolute inset-x-0 z-10" style={{ bottom: "calc(var(--nav-h) + var(--nav-gap) + var(--sab) + 10px)" }}>
          {visible.length === 0 ? (
            <div className="mx-3 bg-paper shadow-float rounded-[22px] p-5 text-[15px] flex items-center gap-3 max-w-[640px] sm:mx-auto">
              <span className="text-2xl">👆</span><span className="flex-1"><b>지도를 눌러 가고 싶은 곳을 추가해요</b><br /><span className="text-muted">검색창에서 이름으로 찾거나 네이버·카카오 링크도 넣을 수 있어요.</span></span>
            </div>
          ) : (
            <div ref={carousel} className="flex gap-2.5 overflow-x-auto no-scrollbar snap-x-cards px-3 pb-1">
              {visible.map((p) => {
                const o = order[p.id];
                const sel = p.id === ui.selectedPlaceId;
                return (
                  <div key={p.id} data-card={p.id} role="button" tabIndex={0} aria-label={p.name} onClick={() => (sel ? (setAutoWalk(false), setDetailOpen(true)) : select(p))}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (sel) { setAutoWalk(false); setDetailOpen(true); } else select(p); } }}
                    className={`relative overflow-hidden shrink-0 w-[80vw] max-w-[320px] text-left bg-paper rounded-[20px] p-4 shadow-float transition-all active:scale-[.98] cursor-pointer ${sel ? "ring-2 ring-coral" : ""}`}>
                    <div className="flex gap-3">
                      <span className="w-12 h-12 rounded-[14px] flex items-center justify-center text-xl shrink-0" style={{ background: CITY_COLOR[p.city] + "22" }}>{CATEGORY_ICON[p.category]}</span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1"><b className="truncate text-[16px] font-semibold">{p.name}</b>{p.both_want && <span aria-label="둘 다 원함">💕</span>}</span>
                        <span className="text-[13px] text-muted block mt-0.5">{p.city_label} · {CATEGORY_LABEL[p.category]}{o ? ` · DAY ${o.day} #${o.n}` : ""}{o?.visited ? " · 방문 ✓" : ""}{!p.has_location ? " · 위치 미정" : ""}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2">
                      {p.votes.filter((v) => v.preference || v.is_me).slice(0, 4).map((v) => (
                        <span key={v.member_id} className="flex items-center gap-1 text-xs bg-sand rounded-full pl-0.5 pr-2 py-0.5">
                          <Avatar name={v.nickname} index={memberIdx[v.member_id] ?? 0} size={18} />{v.preference ? `${PREF_EMOJI[v.preference]} ${PREF_SHORT[v.preference]}` : "–"}
                        </span>
                      ))}
                      <span className="ml-auto text-xs font-semibold text-coral flex items-center">{sel ? "자세히" : "보기"}<Icon name="chevronR" size={14} /></span>
                    </div>
                    {p.has_location && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); ui.set({ selectedPlaceId: p.id }); setAutoWalk(true); setDetailOpen(true); }}
                        className="mt-3 w-full h-11 rounded-[12px] bg-coral-soft text-coral-ink text-[14px] font-bold flex items-center justify-center gap-1.5 active:bg-[#C9E2FF]">
                        <Icon name="walk" size={18} stroke={2.4} />걸어서 가는 길
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Sheet open={detailOpen && !!selected} backdrop={false} onClose={() => { setDetailOpen(false); setRoutes([]); setStops([]); }}
        title={selected && <PlaceTitle place={selected} />}>
        {selected && <PlaceDetail key={selected.id + (autoWalk ? ":walk" : "")} place={selected} autoWalk={autoWalk} onRoute={setRoutes} onStops={setStops}
          onDeleted={() => { setDetailOpen(false); ui.set({ selectedPlaceId: null }); }} />}
      </Sheet>

      <QuickAdd init={quick} onClose={() => setQuick(null)} onSaved={(id) => {
        setQuick(null); ui.set({ selectedPlaceId: id, city: "all", day: "all" }); setDetailOpen(true);
      }} />

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="지도 필터">
        <div className="space-y-4">
          <FilterRow label="분류" value={ui.category} onChange={(v) => ui.set({ category: v })} options={[["all", "전체"], ...Object.entries(CATEGORY_LABEL)]} />
          <FilterRow label="등록자" value={ui.creator} onChange={(v) => ui.set({ creator: v as never })} options={[["all", "모두"], ["me", "내가"], ["partner", "상대가"]]} />
          <FilterRow label="일정" value={ui.scheduled} onChange={(v) => ui.set({ scheduled: v as never })} options={[["all", "모두"], ["yes", "배정됨"], ["no", "미배정"]]} />
          <label className="flex items-center gap-3 min-h-11">
            <input type="checkbox" className="w-5 h-5 accent-coral" checked={ui.hideVisited} onChange={(e) => ui.set({ hideVisited: e.target.checked })} />
            방문 완료한 곳 숨기기
          </label>
          <button className="btn btn-ghost w-full" onClick={() => ui.set({ category: "all", creator: "all", scheduled: "all", hideVisited: false })}>초기화</button>
        </div>
      </Sheet>
    </div>
  );
}

function Chip({ on, onClick, children, dot }: { on: boolean; onClick: () => void; children: React.ReactNode; dot?: string }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 min-h-10 px-3.5 rounded-full text-sm font-semibold shadow-float flex items-center gap-1.5 transition-all active:scale-95 ${on ? "bg-navy text-white" : "glass text-navy-soft"}`}>
      {dot && <span className="w-2 h-2 rounded-full" style={{ background: dot }} />}{children}
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="pointer-events-auto bg-navy/85 text-white backdrop-blur-md rounded-full px-3.5 py-1.5 text-[13px] font-medium shadow-float">{children}</span>;
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
