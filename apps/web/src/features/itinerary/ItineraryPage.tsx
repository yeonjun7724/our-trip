import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/services/api";
import { CATEGORY_ICON, km, md, minutes, MODE_LABEL, PROVIDER_LABEL } from "@/services/format";
import { useItinerary, usePlaces, useTripId, useTripMutation } from "@/services/queries";
import type { ItineraryDay, Leg, RouteOption, TimelineEntry, TransitResult } from "@/services/types";
import { EmptyState, ErrorState, Header, InlineError, ListSkeleton, Notice, Segmented, Sheet, SourceBadge } from "@/components/ui";
import TransitResults from "@/features/transit/TransitResults";
import Icon, { type IconName } from "@/components/Icon";
import { toast } from "@/components/Toast";

const CONN_STYLE: Record<string, string> = {
  LIKELY_OK: "bg-[#E9F5EE] text-ok", BUFFER_SHORT: "bg-[#FFF4E0] text-warn", MISSED: "bg-[#FDE8E6] text-bad",
  UNVERIFIED: "bg-line text-navy-soft", TIMETABLE_UNVERIFIED: "bg-line text-navy-soft", INSUFFICIENT_DATA: "bg-line text-muted",
};

const MODE_STYLE: Record<string, { icon: IconName; color: string }> = {
  WALK: { icon: "walk", color: "#2F6FDE" }, TRANSIT: { icon: "bus", color: "#E8833A" }, BUS: { icon: "bus", color: "#E8833A" },
  SUBWAY: { icon: "route", color: "#7B5CC4" }, TRAIN: { icon: "train", color: "#1E2A44" }, UNKNOWN: { icon: "route", color: "#A3A9B6" },
};

/** Connector between two timeline nodes: mode, duration, source, and an action to fill unknown legs. */
function LegRow({ leg, onTransit }: { leg: Leg; onTransit?: () => void }) {
  const known = leg.duration_minutes != null;
  const st = MODE_STYLE[leg.mode] ?? MODE_STYLE.UNKNOWN;
  const line = !known
    ? "repeating-linear-gradient(#C9CED8 0 4px, transparent 4px 8px)"
    : leg.mode === "WALK" ? `repeating-linear-gradient(${st.color} 0 3px, transparent 3px 7px)` : `linear-gradient(${st.color}, ${st.color})`;
  return (
    <div className="flex items-stretch gap-3 min-h-12">
      <div className="w-14 shrink-0" />
      <div className="w-6 shrink-0 flex justify-center"><span className="w-0.5" style={{ backgroundImage: line }} /></div>
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap py-1.5">
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: st.color }}>
          <Icon name={st.icon} size={14} />{MODE_LABEL[leg.mode] ?? leg.mode} {known ? minutes(leg.duration_minutes) : "미확인"}
        </span>
        {leg.distance_m ? <span className="text-xs text-muted">{km(leg.distance_m)}</span> : null}
        {leg.summary && <span className="text-xs text-navy-soft truncate max-w-[60%]">{leg.summary}</span>}
        {known && <SourceBadge status={(leg.status as never) ?? "ESTIMATED"} provider={leg.source} at={leg.mode !== "WALK" ? leg.checked_at : undefined} />}
        {onTransit && (leg.suggest_transit || !known || leg.mode !== "WALK") && (
          <button className="ml-auto text-xs text-coral font-bold min-h-9 px-3 rounded-full bg-coral-soft" onClick={onTransit}>
            {leg.mode !== "WALK" && known ? "다시 조회" : leg.suggest_transit ? "대중교통이 나을 수도" : "이동 방법 찾기"}
          </button>
        )}
      </div>
    </div>
  );
}

function Entry({ e, prev, idx, count, onMove, onRemove, onTransit }: {
  e: TimelineEntry; prev: TimelineEntry | null; idx: number; count: number;
  onMove: (d: -1 | 1) => void; onRemove: () => void; onTransit: (from: TimelineEntry | null, to: TimelineEntry) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [fixTime, setFixTime] = useState(e.start ?? "12:00");
  const patch = useTripMutation((body: Record<string, unknown>) => api.patch(`/api/itinerary-items/${e.item_id}`, { version: e.version, ...body }));
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  useEffect(() => setOptimistic(null), [e.version]);
  const visited = optimistic ?? e.visit_status === "VISITED";
  const rail = e.kind === "RAIL";
  const toggle = () => {
    const next = !visited;
    setOptimistic(next);
    patch.mutate({ visit_status: next ? "VISITED" : "PLANNED" }, { onError: () => setOptimistic(null) });
    if (next) toast(rail ? "탑승 완료 🚆" : `'${e.name}' 방문 완료!`);
  };
  return (
    <li>
      {e.leg_in && <LegRow leg={e.leg_in} onTransit={() => onTransit(prev, e)} />}
      <div className="flex items-start gap-3">
        <div className="w-14 shrink-0 text-right pt-2.5">
          <p className="font-mono font-bold text-[15px] leading-none">{rail ? e.departure ?? "–" : e.start ?? "–:–"}</p>
          {!rail && e.end && <p className="font-mono text-[11px] text-muted mt-1">~{e.end}</p>}
          {rail && <p className="font-mono text-[11px] text-muted mt-1">→{e.arrival ?? "–"}</p>}
        </div>
        <button onClick={toggle} aria-label={rail ? "탑승 완료" : "방문 완료"} aria-pressed={visited}
          className={`w-6 h-6 mt-2 shrink-0 rounded-full border-[2.5px] flex items-center justify-center transition-colors ${
            visited ? "bg-ok border-ok text-white" : rail ? "bg-navy border-navy text-white" : "bg-paper border-coral"}`}>
          {visited ? <Icon name="check" size={14} stroke={3} /> : rail ? <Icon name="train" size={12} /> : null}
        </button>
        <div className={`flex-1 min-w-0 card p-3 transition-opacity ${visited ? "opacity-60" : ""} ${rail ? "!bg-[#F2F5FB] !border-navy/25" : ""}`}>
          <div className="flex items-start gap-2">
            <p className={`font-bold flex-1 min-w-0 ${visited ? "line-through" : ""}`}>{rail ? e.name : `${CATEGORY_ICON[e.category ?? ""] ?? "📍"} ${e.name}`}</p>
            <button className="tap -m-2 flex items-center justify-center text-muted" aria-label="더보기" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="menu" size={18} /></button>
          </div>
          {rail ? (
            <>
              <p className="text-xs text-navy-soft">{e.origin} → {e.destination} · {e.reservation_status === "RESERVED" ? "예매 완료" : e.reservation_status === "CANCELLED" ? "취소" : "예매 전"}</p>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className={`chip ${CONN_STYLE[e.connection ?? ""] ?? "bg-line"}`}>{e.connection_label}</span>
                <span className="text-xs text-navy-soft">역 도착 {e.arrival_at_station ?? "미확인"}{e.slack_minutes != null ? ` · 여유 ${e.slack_minutes}분` : ""}</span>
              </div>
              {e.connection_note && <p className="text-[11px] text-muted mt-1">{e.connection_note}</p>}
              <div className="mt-1.5"><SourceBadge status={e.schedule_source === "TAGO_TIMETABLE" ? "SCHEDULED" : "USER_ENTERED"} provider={e.schedule_source} /></div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="chip bg-sand text-navy-soft"><Icon name="clock" size={12} /> {minutes(e.stay_minutes)}</span>
                {e.is_fixed && <span className="chip bg-navy text-white">📌 {e.start} 고정</span>}
                {!e.has_location && <span className="chip bg-[#FFF4E0] text-warn">위치 미정</span>}
                {e.start && !e.is_fixed && <span className="chip bg-[#FFF4E0] text-warn">추정 시각</span>}
              </div>
              {e.conflict && <p className="text-xs text-bad mt-1">⚠ {e.conflict}</p>}
            </>
          )}
          {menu && (
            <div className="mt-2 pt-2 border-t border-line space-y-2 fade-in">
              <div className="flex flex-wrap gap-1.5">
                <button className="btn btn-ghost !min-h-9 text-xs" disabled={idx === 0} onClick={() => onMove(-1)}><Icon name="up" size={14} />위로</button>
                <button className="btn btn-ghost !min-h-9 text-xs" disabled={idx === count - 1} onClick={() => onMove(1)}><Icon name="down" size={14} />아래로</button>
                {!rail && <button className="btn btn-ghost !min-h-9 text-xs text-bad" onClick={onRemove}><Icon name="x" size={14} />이 날에서 빼기</button>}
              </div>
              {!rail && (e.is_fixed ? (
                <button className="btn btn-outline !min-h-9 text-xs" onClick={() => patch.mutate({ is_fixed: false, clear_planned_start: true })}>시간 고정 해제</button>
              ) : (
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-muted">시간 고정</span>
                  <input type="time" className="field !min-h-9 !w-32" value={fixTime} onChange={(ev) => setFixTime(ev.target.value)} aria-label="고정 시각" />
                  <button className="btn btn-primary !min-h-9 text-xs" onClick={() => { patch.mutate({ is_fixed: true, planned_start: fixTime }); setMenu(false); }}>저장</button>
                </div>
              ))}
            </div>
          )}
          {patch.error instanceof ApiError && patch.error.status === 409 && <p className="text-xs text-warn mt-1">다른 사람이 먼저 바꿨어요. 최신 상태로 새로고침했어요.</p>}
        </div>
      </div>
    </li>
  );
}

interface Proposal { day_id: string; base_version: number; proposed_order: string[]; changed: boolean; before: { walk_distance_m: number; legs_needing_transit: number }; after: { walk_distance_m: number; legs_needing_transit: number }; warnings: string[]; method: string }

function DayView({ day }: { day: ItineraryDay }) {
  const tripId = useTripId()!;
  const places = usePlaces(tripId).data ?? [];
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [transitFor, setTransitFor] = useState<{ from: TimelineEntry | null; to: TimelineEntry } | null>(null);
  const [tRes, setTRes] = useState<TransitResult | null>(null);

  const write = useTripMutation((ids: { item_id?: string; place_id?: string }[]) =>
    api.post(`/api/trips/${tripId}/itinerary`, { day_id: day.id, base_version: day.version, items: ids }));
  const dayPatch = useTripMutation((b: Record<string, unknown>) => api.patch(`/api/trips/${tripId}/days/${day.id}`, { version: day.version, ...b }));
  const optimize = useMutation({ mutationFn: () => api.post<Proposal>(`/api/trips/${tripId}/optimize`, { day_id: day.id }), onSuccess: setProposal });
  const approve = useTripMutation((p: Proposal) => api.post(`/api/trips/${tripId}/itinerary`, {
    day_id: day.id, base_version: p.base_version, items: p.proposed_order.map((i) => ({ item_id: i })) }), () => setProposal(null));
  const transit = useMutation({ mutationFn: (b: unknown) => api.post<TransitResult>("/api/transit/routes", b), onSuccess: setTRes });
  const saveLeg = useTripMutation((o: RouteOption) => api.post(`/api/trips/${tripId}/legs`, {
    from_item_id: transitFor?.from?.item_id ?? null, to_item_id: transitFor!.to.item_id, mode: "TRANSIT",
    duration_minutes: o.total_minutes != null ? Math.round(o.total_minutes) : null, transfer_count: o.transfer_count,
    summary: o.lines.join(" → ").slice(0, 300) || "대중교통", source: "ODSAY",
  }), () => { setTransitFor(null); setTRes(null); });

  const ids = day.entries.map((e) => ({ item_id: e.item_id }));
  const move = (i: number, d: -1 | 1) => { const n = [...ids]; [n[i], n[i + d]] = [n[i + d], n[i]]; write.mutate(n); };
  const lodgings = places.filter((p) => p.category === "LODGING");
  const where = (e: TimelineEntry | null) => {
    if (!e) return day.lodging ? places.find((p) => p.id === day.lodging!.id) : null;
    return e.kind === "PLACE" ? places.find((p) => p.id === e.place_id) : null;
  };
  const openTransit = (from: TimelineEntry | null, to: TimelineEntry) => {
    setTransitFor({ from, to }); setTRes(null);
    const a = where(from), b = to.kind === "PLACE" ? places.find((p) => p.id === to.place_id) : null;
    if (a?.has_location && b?.has_location) {
      transit.mutate({ origin: { lat: a.latitude, lon: a.longitude, label: a.name }, destination: { lat: b.latitude, lon: b.longitude, label: b.name } });
    }
  };
  const entryName = (id: string) => day.entries.find((e) => e.item_id === id)?.name ?? "?";

  return (
    <div className="space-y-3">
      <div className="card p-3 grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">출발 시각
          <input type="time" className="field !min-h-10" defaultValue={day.start_time} onBlur={(e) => e.target.value !== day.start_time && dayPatch.mutate({ start_time: e.target.value })} /></label>
        <label className="text-xs text-muted">출발 숙소
          <select className="field !min-h-10" value={day.lodging?.id ?? ""} onChange={(e) => dayPatch.mutate(e.target.value ? { lodging_place_id: e.target.value } : { clear_lodging: true })}>
            <option value="">없음</option>{lodgings.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>
        <p className="col-span-2 text-xs text-navy-soft">도보 합계 {km(day.walk_distance_m)} · 종료 예상 {day.end ?? "미확인"}{day.unknown_legs ? ` · 이동시간 미확인 ${day.unknown_legs}구간` : ""}</p>
      </div>
      <InlineError error={dayPatch.error} />
      {day.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
      {day.entries.length === 0 ? (
        <EmptyState icon="🗓️" title="이 날 일정이 비어 있어요" body="아래 미배정 장소에서 넣거나 위시리스트에서 날짜를 골라 주세요." />
      ) : (
        <ol className="space-y-0 pt-1">
          {day.entries.map((e, i) => (
            <Entry key={e.item_id} e={e} prev={i ? day.entries[i - 1] : null} idx={i} count={day.entries.length}
              onMove={(d) => move(i, d)} onRemove={() => write.mutate(ids.filter((x) => x.item_id !== e.item_id))} onTransit={openTransit} />
          ))}
        </ol>
      )}
      <InlineError error={write.error} />
      {day.entries.length >= 3 && (
        <button className="btn btn-outline w-full" disabled={optimize.isPending} onClick={() => optimize.mutate()}>
          {optimize.isPending ? "계산 중…" : "✨ 도보 동선 최적화 추천"}
        </button>
      )}
      <InlineError error={optimize.error} />

      <Sheet open={!!proposal} onClose={() => setProposal(null)} title="추천 방문 순서">
        {proposal && (
          <div className="space-y-3">
            {!proposal.changed ? <Notice>지금 순서가 이미 가장 짧은 동선이에요.</Notice> : (
              <ol className="card divide-y divide-line">
                {proposal.proposed_order.map((id, i) => <li key={id} className="px-3 py-2.5 text-sm"><b className="mr-2">{i + 1}</b>{entryName(id)}</li>)}
              </ol>
            )}
            <p className="text-sm">도보 거리 {km(proposal.before.walk_distance_m)} → <b>{km(proposal.after.walk_distance_m)}</b>
              {proposal.after.legs_needing_transit ? ` · 대중교통 필요 구간 ${proposal.after.legs_needing_transit}` : ""}</p>
            {proposal.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
            <p className="text-[11px] text-muted">{proposal.method}. 승인해야 일정에 반영돼요.</p>
            <InlineError error={approve.error} />
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setProposal(null)}>그대로 둘게</button>
              <button className="btn btn-primary flex-1" disabled={!proposal.changed || approve.isPending} onClick={() => approve.mutate(proposal)}>이 순서로 적용</button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!transitFor} onClose={() => { setTransitFor(null); setTRes(null); }} title={`→ ${transitFor?.to.name ?? ""} 이동`}>
        {transit.isPending && <ListSkeleton rows={2} />}
        {transit.error && <ErrorState error={transit.error} />}
        {!transit.isPending && !tRes && <Notice>출발지나 도착지 위치가 확정되지 않았거나 열차 구간이라 경로를 조회할 수 없어요.</Notice>}
        {tRes && <TransitResults result={tRes} onPick={(o) => saveLeg.mutate(o)} pickLabel="이 경로로 일정에 반영" />}
        <InlineError error={saveLeg.error} />
      </Sheet>
    </div>
  );
}

interface Suggestion { place_id: string; name: string; day_id: string | null; day_number?: number; reason: string }

export default function ItineraryPage() {
  const tripId = useTripId();
  const q = useItinerary(tripId);
  const [dayNo, setDayNo] = useState(1);
  const [sugg, setSugg] = useState<Suggestion[] | null>(null);
  const suggest = useMutation({ mutationFn: () => api.post<{ suggestions: Suggestion[] }>(`/api/trips/${tripId}/optimize`, {}), onSuccess: (r) => setSugg(r.suggestions) });
  const addTo = useTripMutation((x: { dayId: string; placeId: string }) => {
    const d = q.data!.days.find((y) => y.id === x.dayId)!;
    return api.post(`/api/trips/${tripId}/itinerary`, { day_id: d.id, base_version: d.version, items: [...d.entries.map((e) => ({ item_id: e.item_id })), { place_id: x.placeId }] });
  });
  useEffect(() => { if (q.data && !q.data.days.some((d) => d.day_number === dayNo)) setDayNo(1); }, [q.data, dayNo]);

  if (q.isLoading) return <div className="page"><ListSkeleton rows={4} /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const data = q.data!;
  const day = data.days.find((d) => d.day_number === dayNo) ?? data.days[0];

  return (
    <div className="page">
      <Header title="일정" sub={day ? `${md(day.travel_date)} · ${day.primary_city_label}` : ""} />
      <Segmented value={String(dayNo)} onChange={(v) => setDayNo(Number(v))}
        options={data.days.map((d) => ({ value: String(d.day_number), label: `DAY ${d.day_number} ${d.primary_city_label}` }))} />
      <div className="mt-4">{day && <DayView key={day.id} day={day} />}</div>

      <section className="mt-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold">미배정 장소 {data.unassigned.length}</h2>
          {data.unassigned.length > 0 && <button className="text-sm text-coral font-semibold min-h-11" onClick={() => suggest.mutate()}>날짜 추천 받기</button>}
        </div>
        {sugg && (
          <div className="card p-3 mb-3 space-y-2">
            <p className="text-sm font-semibold">추천 (승인한 것만 반영돼요)</p>
            {sugg.length === 0 && <p className="text-sm text-muted">추천할 장소가 없어요.</p>}
            {sugg.map((s) => (
              <div key={s.place_id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{s.name} → {s.day_number ? `DAY ${s.day_number}` : "–"}<br /><span className="text-xs text-muted">{s.reason}</span></span>
                {s.day_id && <button className="btn btn-ghost !min-h-9 text-xs" onClick={() => { addTo.mutate({ dayId: s.day_id!, placeId: s.place_id }); setSugg(sugg.filter((x) => x.place_id !== s.place_id)); }}>승인</button>}
              </div>
            ))}
          </div>
        )}
        <ul className="space-y-2">
          {data.unassigned.map((p) => (
            <li key={p.id} className="card p-3 flex items-center gap-2">
              <span className="flex-1 min-w-0"><b className="truncate block">{CATEGORY_ICON[p.category]} {p.name}</b><span className="text-xs text-muted">{p.city_label} · 점수 {p.priority_score}{p.both_want ? " · 둘 다" : ""}</span></span>
              {day && <button className="btn btn-ghost !min-h-10 text-sm shrink-0" onClick={() => addTo.mutate({ dayId: day.id, placeId: p.id })}>DAY {day.day_number}에 넣기</button>}
            </li>
          ))}
        </ul>
        <InlineError error={addTo.error} />
      </section>
      <div className="mt-6 space-y-1">{data.notes.map((n) => <p key={n} className="text-[11px] text-muted">· {n}</p>)}
        <p className="text-[11px] text-muted">· 출처 표기: {PROVIDER_LABEL.OSMNX} — © OpenStreetMap contributors</p></div>
    </div>
  );
}
