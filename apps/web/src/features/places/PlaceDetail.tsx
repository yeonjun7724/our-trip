import HelpButton from "@/components/Help";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/services/api";
import { CATEGORY_LABEL, CITY_COLOR, km, minutes, PREF_LABEL, PREF_STYLE, ago } from "@/services/format";
import { useItinerary, usePlaces, useTrip, useTripId, useTripMutation } from "@/services/queries";
import type { Place, Pref, TransitResult } from "@/services/types";
import { Avatar, InlineError, Notice, SourceBadge } from "@/components/ui";
import Icon from "@/components/Icon";
import { toast } from "@/components/Toast";
import type { RouteFeature } from "@/components/MapView";
import LocationPicker from "@/components/LocationPicker";
import NearbyStops from "@/features/transit/NearbyStops";
import TransitResults, { TransitSearchButton } from "@/features/transit/TransitResults";
import Comments from "./Comments";

interface WalkRes {
  status: string; distance_m: number | null; duration_minutes: number | null; warnings: string[];
  feature: { geometry: RouteFeature["geometry"] } | null; graph_version: string | null;
}

export default function PlaceDetail({ place, onRoute, onStops, onDeleted, autoWalk = false }: {
  place: Place; onRoute?: (f: RouteFeature[]) => void; onStops?: (s: import("@/services/types").Stop[]) => void; onDeleted?: () => void;
  /** start an OSMnx walking route from the current location as soon as the sheet opens */
  autoWalk?: boolean;
}) {
  const tripId = useTripId()!;
  const places = usePlaces(tripId).data ?? [];
  const it = useItinerary(tripId).data;
  const [memo, setMemo] = useState(place.memo ?? "");
  const [picker, setPicker] = useState(false);
  const [originId, setOriginId] = useState<string>("me");
  const [walk, setWalk] = useState<WalkRes | null>(null);
  const [transit, setTransit] = useState<TransitResult | null>(null);
  const [showStops, setShowStops] = useState(false);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [myPos, setMyPos] = useState<{ lat: number; lon: number } | null>(null);

  const vote = useTripMutation((p: Pref | null) => api.post(`/api/places/${place.id}/votes`, { preference: p }),
    () => toast("내 선호도를 저장했어요"));
  const trip = useTrip(tripId).data;
  const midx = Object.fromEntries((trip?.members ?? []).map((m, i) => [m.id, i]));
  const patch = useTripMutation((body: Record<string, unknown>) => api.patch(`/api/places/${place.id}`, { version: place.version, ...body }), () => toast("저장했어요"));
  const del = useTripMutation(() => api.del(`/api/places/${place.id}`), () => { toast("삭제했어요"); onDeleted?.(); });
  const assign = useTripMutation((dayId: string) => {
    const d = it!.days.find((x) => x.id === dayId)!;
    return api.post(`/api/trips/${tripId}/itinerary`, { day_id: d.id, base_version: d.version,
      items: [...d.entries.map((e) => ({ item_id: e.item_id })), { place_id: place.id }] });
  }, () => toast("일정에 넣었어요 🗓️"));

  const origins = places.filter((p) => p.has_location && p.id !== place.id);
  const origin = originId === "me" ? (myPos ? { ...myPos, label: "현재 위치" } : null)
    : (() => { const o = origins.find((p) => p.id === originId); return o ? { lat: o.latitude!, lon: o.longitude!, label: o.name } : null; })();
  const dest = place.has_location ? { lat: place.latitude!, lon: place.longitude!, label: place.name } : null;

  const locate = () => {
    setGeoErr(null);
    if (!navigator.geolocation) { setGeoErr("이 브라우저는 위치 확인을 지원하지 않아요."); return; }
    navigator.geolocation.getCurrentPosition((p) => setMyPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => setGeoErr("현재 위치를 가져오지 못했어요. 위치 권한을 확인하거나 출발 장소를 골라 주세요."), { enableHighAccuracy: true, timeout: 10000 });
  };
  const walkM = useMutation({
    mutationFn: () => api.post<WalkRes>("/api/routes/walking", { origin, destination: dest }),
    onSuccess: (r) => { setWalk(r); if (r.feature) onRoute?.([{ geometry: r.feature.geometry, mode: "WALK" }]); },
  });
  // "walk now": find me (if needed), then run the OSMnx route once the origin is known
  const [walkWanted, setWalkWanted] = useState(autoWalk);
  const startWalk = () => {
    setWalkWanted(true);
    document.getElementById("pd-route")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (originId === "me" && !myPos) locate();
  };
  useEffect(() => { if (autoWalk && dest) startWalk(); }, []); // eslint-disable-line
  useEffect(() => {
    if (walkWanted && origin && dest && !walkM.isPending) { setWalkWanted(false); walkM.mutate(); }
  }, [walkWanted, origin?.lat, origin?.lon]); // eslint-disable-line

  const assignedDay = it?.days.find((d) => d.entries.some((e) => e.place_id === place.id));
  const conflict = patch.error instanceof ApiError && patch.error.status === 409;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5 text-xs">
        {place.provider !== "MANUAL" && place.provider !== "SEED" && <span className="chip bg-sand">{place.provider === "NAVER" ? "네이버 링크" : "카카오 링크"}</span>}
        {place.both_want && <span className="chip bg-coral text-white">둘 다 가고 싶어</span>}
      </div>
      <p className="text-xs text-muted -mt-3">
        {place.created_by ?? "?"} 등록{place.updated_by && place.updated_by !== place.created_by ? ` · ${place.updated_by} 수정` : ""} · {ago(place.updated_at)}
      </p>

      <div className="grid grid-cols-4 gap-2">
        {[
          { i: "walk" as const, l: "도보 길찾기", on: startWalk, dis: !dest },
          { i: "calendar" as const, l: assignedDay ? `DAY ${assignedDay.day_number}` : "일정", on: () => document.getElementById("pd-plan")?.scrollIntoView({ behavior: "smooth" }), dis: false },
          { i: "bus" as const, l: "정류장", on: () => { setShowStops(true); setTimeout(() => document.getElementById("pd-stops")?.scrollIntoView({ behavior: "smooth" }), 50); }, dis: !dest },
          { i: "share" as const, l: "공유", on: async () => {
              const url = place.share_url ?? place.external_links[0]?.url ?? location.href;
              if (navigator.share) { try { await navigator.share({ title: place.name, url }); } catch { /* cancelled */ } }
              else { await navigator.clipboard?.writeText(url); toast("링크를 복사했어요"); } }, dis: false },
        ].map((a) => (
          <button key={a.l} disabled={a.dis} onClick={a.on} className="card py-2.5 flex flex-col items-center gap-1 text-xs font-semibold disabled:opacity-40 active:bg-sand">
            <span className="w-9 h-9 rounded-full bg-coral-soft text-coral flex items-center justify-center"><Icon name={a.i} size={18} /></span>{a.l}
          </button>
        ))}
      </div>

      <section>
        <h3 className="text-[17px] font-bold tracking-[-0.02em] mb-3">우리 선호도</h3>
        <div className="grid grid-cols-2 gap-2">
          {place.votes.filter((v) => v.preference || v.is_me).map((v) => (
            <div key={v.member_id} className="card px-3 py-2">
              <p className="text-xs text-muted flex items-center gap-1.5"><Avatar name={v.nickname} index={midx[v.member_id] ?? 0} size={18} />{v.nickname}{v.is_me ? " (나)" : ""}</p>
              <p className="font-semibold text-sm">{v.preference ? PREF_LABEL[v.preference] : "아직 안 골랐어요"}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1.5 mt-2" role="radiogroup" aria-label="내 선호도">
          {(["MUST", "GOOD", "MAYBE", "SKIP"] as Pref[]).map((p) => (
            <button key={p} role="radio" aria-checked={place.my_vote === p}
              className={`min-h-14 rounded-2xl text-[12px] font-semibold border flex flex-col items-center justify-center gap-0.5 transition-colors ${place.my_vote === p ? PREF_STYLE[p] + " border-transparent" : "bg-paper border-line"}`}
              onClick={() => vote.mutate(place.my_vote === p ? null : p)}>
              <span className={`text-lg leading-none ${place.my_vote === p ? "pop" : ""}`}>{({ MUST: "😍", GOOD: "🙂", MAYBE: "🤔", SKIP: "🙅" } as const)[p]}</span>{PREF_LABEL[p]}</button>
          ))}
        </div>
        <p className="text-xs text-muted mt-1">추천 점수 {place.priority_score} (참고용 지표)</p>
      </section>

      <section id="pd-plan">
        <h3 className="text-[17px] font-bold tracking-[-0.02em] mb-3">일정</h3>
        {assignedDay ? <p className="text-sm">DAY {assignedDay.day_number} {assignedDay.primary_city_label}에 들어가 있어요.</p> : (
          <div className="flex flex-wrap gap-2">
            {it?.days.map((d) => (
              <button key={d.id} className={`btn text-sm ${d.primary_city === place.city ? "btn-primary" : "btn-outline"}`}
                disabled={assign.isPending} onClick={() => assign.mutate(d.id)}>DAY {d.day_number} {d.primary_city_label}</button>
            ))}
          </div>
        )}
        <InlineError error={assign.error} />
      </section>

      <section>
        <h3 className="text-[17px] font-bold tracking-[-0.02em] mb-3">위치</h3>
        {place.has_location ? (
          <div className="flex items-center gap-2 flex-wrap">
            <SourceBadge status={place.coordinate_source === "USER_PICKED" ? "USER_ENTERED" : "VERIFIED_STATIC"}
              provider={place.coordinate_source === "USER_PICKED" ? "USER" : place.coordinate_source === "TOURAPI" ? "TOURAPI" : "NOMINATIM"} />
            <button className="text-sm text-coral font-semibold min-h-11 px-2" onClick={() => setPicker(true)}>위치 수정</button>
          </div>
        ) : (
          <>
            <Notice tone="warn">위치가 확정되지 않았어요. 경로를 계산하려면 지도에서 위치를 지정해 주세요.</Notice>
            <button className="btn btn-primary w-full mt-2" onClick={() => setPicker(true)}>지도에서 위치 지정</button>
          </>
        )}
      </section>

      {dest && (
        <section id="pd-route" className="rounded-[20px] bg-coral-soft p-4 scroll-mt-4">
          <div className="flex items-start gap-3 mb-3">
            <span className="w-11 h-11 rounded-full bg-coral text-white flex items-center justify-center shrink-0"><Icon name="walk" size={22} stroke={2.2} /></span>
            <div className="min-w-0">
              <h3 className="text-[17px] font-bold tracking-[-0.02em]">걸어서 가는 길</h3>
              <p className="text-[13px] text-navy-soft leading-snug mt-0.5">OpenStreetMap 실제 보행로를 OSMnx로 계산해서 지도에 길을 그려줘요.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <select className="field" value={originId} onChange={(e) => { setOriginId(e.target.value); setWalk(null); setTransit(null); }} aria-label="출발지">
              <option value="me">현재 위치</option>
              {origins.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {originId === "me" && <button className="btn btn-ghost shrink-0" onClick={locate}>{myPos ? "다시 찾기" : "위치 찾기"}</button>}
          </div>
          {geoErr && <p className="text-sm text-bad mt-1">{geoErr}</p>}
          <button className="btn btn-primary w-full mt-2 !min-h-14 text-[17px]" disabled={walkM.isPending || (walkWanted && !origin && !geoErr)}
            onClick={() => (origin ? walkM.mutate() : startWalk())}>
            <Icon name="walk" size={20} stroke={2.4} />{walkM.isPending ? "보행로 계산 중…" : walkWanted && !origin && !geoErr ? "현재 위치 찾는 중…" : walk ? "도보 경로 다시 찾기" : "도보 길찾기"}
          </button>
          {origin && <div className="flex mt-2"><TransitSearchButton origin={origin} destination={dest} onResult={setTransit} /></div>}
          {walk && (
            <div className="bg-paper rounded-[16px] p-4 mt-2">
              {walk.status === "OK" ? (
                <>
                  <p className="text-[13px] text-muted">{origin?.label ?? "출발지"}에서 걸어서</p>
                  <p className="text-[24px] font-bold tracking-[-0.03em] num">{minutes(walk.duration_minutes)} <span className="text-[16px] font-semibold text-navy-soft">· {km(walk.distance_m)}</span></p>
                  {onRoute && <p className="text-[13px] text-coral-ink font-semibold mt-0.5">지도에 파란 점선으로 길을 표시했어요</p>}
                  <div className="mt-2"><SourceBadge status="ESTIMATED" provider="OSMNX" /></div>
                </>
              ) : <p className="text-sm">{walk.warnings[0] ?? "도보 경로를 계산할 수 없어요."}</p>}
              {walk.status === "OK" && walk.warnings.map((w) => <p key={w} className="text-xs text-warn mt-1">{w}</p>)}
            </div>
          )}
          {transit && <div className="mt-2"><TransitResults result={transit} onShow={onRoute} /></div>}
        </section>
      )}

      {dest && (
        <section id="pd-stops">
          <button className="flex w-full items-center justify-between min-h-11 font-bold" onClick={() => setShowStops(!showStops)} aria-expanded={showStops}>
            주변 버스·지하철 <span aria-hidden>{showStops ? "▴" : "▾"}</span>
          </button>
          {showStops && <NearbyStops lat={dest.lat} lon={dest.lon} onStops={onStops} />}
        </section>
      )}

      <Comments placeId={place.id} memberIdx={midx} />

      <section>
        <h3 className="text-[17px] font-bold tracking-[-0.02em] mb-3">여행 메모</h3>
        <textarea className="field min-h-24" value={memo} maxLength={2000} onChange={(e) => setMemo(e.target.value)} placeholder="예: 해 질 무렵에 가기" />
        <div className="flex gap-2 mt-2 items-center">
          <label className="text-sm text-navy-soft flex items-center gap-2">머무는 시간
            <select className="field w-28" value={place.stay_minutes} onChange={(e) => patch.mutate({ stay_minutes: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90, 120, 150, 180, 240].map((m) => <option key={m} value={m}>{minutes(m)}</option>)}
            </select>
          </label>
          <button className="btn btn-ghost ml-auto" disabled={patch.isPending || memo === (place.memo ?? "")} onClick={() => patch.mutate({ memo })}>메모 저장</button>
        </div>
        {conflict ? <Notice tone="warn">다른 사람이 먼저 수정했어요. 최신 내용으로 바뀌었으니 확인 후 다시 저장해 주세요.</Notice> : <InlineError error={patch.error} />}
      </section>

      <section className="flex flex-wrap gap-2">
        {place.share_url && <a href={place.share_url} target="_blank" rel="noreferrer" className="btn btn-outline text-sm">저장한 링크 열기 ↗</a>}
        {place.external_links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="btn btn-outline text-sm">{l.label} ↗</a>)}
      </section>

      <button className="btn w-full text-bad bg-[#FFEEF0]" onClick={() => { if (confirm(`'${place.name}'을(를) 삭제할까요? 일정에서도 빠져요.`)) del.mutate(undefined); }}>장소 삭제</button>

      <LocationPicker open={picker} onClose={() => setPicker(false)} city={place.city} query={place.name}
        initial={place.has_location ? { lat: place.latitude!, lon: place.longitude! } : null}
        onPick={(p) => patch.mutate({ latitude: p.lat, longitude: p.lon, coordinate_source: p.source, osm_ref: p.osm_ref ?? null })} />
    </div>
  );
}

/** Rich sheet title: category tile tinted by city + name + meta. */
export function PlaceTitle({ place }: { place: Place }) {
  const tint = CITY_COLOR[place.city];
  return (
    <span className="flex items-center gap-3 min-w-0">
      <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-[22px] shrink-0" style={{ background: tint + "22" }}>
        {({ ATTRACTION: "📸", CAFE: "☕", FOOD: "🍜", LODGING: "🛏️", SHOPPING: "🛍️", STATION: "🚉" } as Record<string, string>)[place.category] ?? "📍"}
      </span>
      <span className="min-w-0 flex flex-col">
        <span className="truncate text-[19px] leading-tight">{place.name}{place.both_want ? " 💕" : ""}</span>
        <span className="text-[12px] font-semibold text-muted">{place.city_label} · {CATEGORY_LABEL[place.category] ?? place.category}</span>
      </span>
      <HelpButton page="place" className="ml-auto" />
    </span>
  );
}
