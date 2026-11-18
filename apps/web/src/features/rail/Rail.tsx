import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/services/api";
import { hm, md, minutes } from "@/services/format";
import { usePass, useReservations, useTrip, useTripId, useTripMutation } from "@/services/queries";
import type { Reservation, Train } from "@/services/types";
import { EmptyState, ErrorState, InlineError, ListSkeleton, Notice, SourceBadge } from "@/components/ui";

const KORAIL = "https://www.korail.com";
interface Station { station_id: string; name: string; city_name: string | null }

function StationInput({ label, value, onChange }: { label: string; value: Station | null; onChange: (s: Station | null) => void }) {
  const [q, setQ] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  useEffect(() => { if (value) setQ(value.name); }, [value?.station_id]); // eslint-disable-line
  const res = useQuery({
    queryKey: ["stations", q], enabled: open && q.trim().length >= 1, retry: false, staleTime: 3600_000,
    queryFn: () => api.get<{ stations: Station[] }>(`/api/rail/stations?${qs({ q: q.trim() })}`),
  });
  return (
    <div className="relative">
      <label className="label">{label}</label>
      <input className="field" value={q} placeholder="역 이름" aria-label={label}
        onChange={(e) => { setQ(e.target.value); setOpen(true); onChange(null); }} onFocus={() => setOpen(true)} />
      {value && <p className="text-[11px] text-muted mt-0.5">공식 역 ID {value.station_id}</p>}
      {open && q.trim() && (
        <div className="absolute z-20 left-0 right-0 mt-1 card max-h-56 overflow-y-auto shadow-lg">
          {res.isLoading && <p className="p-3 text-sm text-muted">찾는 중…</p>}
          {res.error && <p className="p-3 text-sm text-bad">{(res.error as ApiError).message}</p>}
          {res.data?.stations.length === 0 && <p className="p-3 text-sm text-muted">일치하는 공식 역이 없어요.</p>}
          {res.data?.stations.map((s) => (
            <button key={s.station_id} className="w-full text-left px-3 min-h-11 border-b border-line last:border-0"
              onClick={() => { onChange(s); setQ(s.name); setOpen(false); }}>
              <b>{s.name}</b> <span className="text-xs text-muted">{s.city_name} · {s.station_id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Official TAGO station IDs, verified with a live call on 2026-11-18.
const STATIONS: Record<string, Station> = {
  busan: { station_id: "NAT014445", name: "부산", city_name: "부산광역시" },
  gyeongju: { station_id: "NATH13421", name: "경주", city_name: "경상북도" },
  pohang: { station_id: "NAT8B0351", name: "포항", city_name: "경상북도" },
};
const QUICK: [string, string, string, number][] = [
  ["부산 → 경주", "busan", "gyeongju", 2], ["경주 → 포항", "gyeongju", "pohang", 3], ["포항 → 부산", "pohang", "busan", 3],
];

interface TimetableRes { status: string; trains: Train[]; message?: string | null; notice?: string; fetched_at: string; direct_available: boolean }
interface TransferRes { status: string; candidates: { first: Train; second: Train; transfer_minutes: number; total_minutes: number | null }[]; notice: string; fetched_at: string }

export function RailSearch() {
  const tripId = useTripId()!;
  const trip = useTrip(tripId).data;
  const [dep, setDep] = useState<Station | null>(null);
  const [arr, setArr] = useState<Station | null>(null);
  const [via, setVia] = useState<Station | null>(null);
  const [date, setDate] = useState("");
  const [hours, setHours] = useState<[number, number]>([5, 23]);
  const [type, setType] = useState("");
  const [minTransfer, setMinTransfer] = useState(15);
  useEffect(() => { if (!date && trip?.days[2]?.travel_date) setDate(trip.days[2].travel_date); }, [trip, date]);

  const tt = useMutation({
    mutationFn: () => api.get<TimetableRes>(`/api/rail/timetable?${qs({ dep: dep!.station_id, arr: arr!.station_id, date, from_hour: hours[0], to_hour: hours[1], train_type: type })}`),
  });
  const tr = useMutation({
    mutationFn: () => api.get<TransferRes>(`/api/rail/transfer-candidates?${qs({ dep: dep!.station_id, via: via!.station_id, arr: arr!.station_id, date, min_transfer: minTransfer })}`),
  });
  const add = useTripMutation((t: Train) => api.post(`/api/trips/${tripId}/rail-reservations`, {
    train_number: t.train_no, train_type: t.train_type, origin_station_id: dep?.station_id, origin_station_name: t.origin_name ?? dep?.name,
    destination_station_id: arr?.station_id, destination_station_name: t.destination_name ?? arr?.name,
    scheduled_departure: t.departure, scheduled_arrival: t.arrival, from_timetable: true, schedule_checked_at: tt.data?.fetched_at,
  }));
  const notConfigured = tt.error instanceof ApiError && tt.error.code === "RAIL_NOT_CONFIGURED";

  return (
    <div className="space-y-4">
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar -mx-5 px-5 pb-1">
        {QUICK.map(([label, a, b, dayIdx]) => (
          <button key={label} aria-label={`DAY ${dayIdx + 1} ${label}`} className={`bg-paper rounded-[18px] shrink-0 w-[168px] px-4 py-3.5 text-left active:scale-[.97] transition-all ${dep?.station_id === STATIONS[a].station_id && arr?.station_id === STATIONS[b].station_id ? "ring-2 ring-coral" : ""}`}
            onClick={() => { setDep(STATIONS[a]); setArr(STATIONS[b]); const d = trip?.days[dayIdx]?.travel_date; if (d) setDate(d); tt.reset(); }}>
            <span className="text-[13px] font-semibold text-coral block">DAY {dayIdx + 1}</span>
            <span className="flex items-center gap-2 mt-1">
              <span className="font-bold text-[17px] tracking-[-0.03em]">{STATIONS[a].name}</span>
              <span className="flex-1 border-t-[1.5px] border-dashed border-[#D1D6DB]" />
              <span className="font-bold text-[17px] tracking-[-0.03em]">{STATIONS[b].name}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="card p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <StationInput label="출발역" value={dep} onChange={setDep} />
          <StationInput label="도착역" value={arr} onChange={setArr} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="rd">출발 날짜</label><input id="rd" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label" htmlFor="rt">열차 종류</label>
            <select id="rt" className="field" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">전체</option><option value="KTX">KTX</option><option value="ITX">ITX</option><option value="새마을">새마을</option><option value="무궁화">무궁화</option>
            </select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-navy-soft">이 시각부터
            <select className="field mt-1" value={hours[0]} onChange={(e) => setHours([Number(e.target.value), Math.max(Number(e.target.value), hours[1])])}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}시</option>)}
            </select></label>
          <label className="text-xs font-semibold text-navy-soft">이 시각까지
            <select className="field mt-1" value={hours[1]} onChange={(e) => setHours([Math.min(hours[0], Number(e.target.value)), Number(e.target.value)])}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}시대</option>)}
            </select></label>
        </div>
        <button className="btn btn-primary w-full" disabled={!dep || !arr || !date || tt.isPending} onClick={() => tt.mutate()}>{tt.isPending ? "조회 중…" : "시간표 조회"}</button>
      </div>

      {notConfigured && (
        <Notice>열차정보 API(TAGO) 키가 아직 설정되지 않았어요. <a className="underline font-semibold" href={KORAIL} target="_blank" rel="noreferrer">코레일</a>에서 시간을 확인한 뒤 '내 열차'에서 직접 기록할 수 있어요 (직접 입력으로 표시돼요).</Notice>
      )}
      {tt.error && !notConfigured && <ErrorState error={tt.error} retry={() => tt.mutate()} />}
      {tt.data && (
        <div className="space-y-2">
          {tt.data.message && <Notice tone="warn">{tt.data.message}</Notice>}
          {tt.data.trains.map((t, i) => (
            <div key={`${t.train_no}-${i}`} className="card p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-bold">{hm(t.departure)} → {hm(t.arrival)} <span className="text-sm font-normal text-navy-soft">{minutes(t.duration_minutes)}</span></p>
                <p className="text-xs text-muted">{t.train_type} {t.train_no} · {t.origin_name}→{t.destination_name}{t.adult_fare_krw ? ` · 일반 ${t.adult_fare_krw.toLocaleString()}원(API 제공)` : ""}</p>
              </div>
              <button className="btn btn-ghost text-sm shrink-0" disabled={add.isPending} onClick={() => add.mutate(t)}>추가</button>
            </div>
          ))}
          <div className="flex gap-2 items-center"><SourceBadge status="SCHEDULED" provider="TAGO" at={tt.data.fetched_at} /></div>
          {tt.data.notice && <p className="text-[11px] text-muted">{tt.data.notice}</p>}
          {add.isSuccess && <Notice>열차를 '내 열차'에 추가했어요. 예매는 코레일에서 따로 해야 해요.</Notice>}
          <InlineError error={add.error} />
        </div>
      )}
      {tt.data && !tt.data.direct_available && (
        <div className="card p-5 space-y-3">
          <p className="font-bold">환승 후보 검토</p>
          <StationInput label="환승역" value={via} onChange={setVia} />
          <label className="text-sm flex items-center gap-2">최소 환승시간
            <select className="field w-28" value={minTransfer} onChange={(e) => setMinTransfer(Number(e.target.value))}>
              {[10, 15, 20, 30, 45].map((m) => <option key={m} value={m}>{m}분</option>)}
            </select></label>
          <button className="btn btn-outline w-full" disabled={!via || tr.isPending} onClick={() => tr.mutate()}>환승 후보 찾기</button>
          {tr.error && <ErrorState error={tr.error} />}
          {tr.data?.candidates.map((c, i) => (
            <div key={i} className="rounded-xl bg-ivory p-3 text-sm">
              <p><b>{hm(c.first.departure)}</b> {c.first.train_type} {c.first.train_no} → {c.first.destination_name} {hm(c.first.arrival)}</p>
              <p className="text-warn text-xs my-0.5">환승 {c.transfer_minutes}분</p>
              <p><b>{hm(c.second.departure)}</b> {c.second.train_type} {c.second.train_no} → {hm(c.second.arrival)}</p>
            </div>
          ))}
          {tr.data && <p className="text-[11px] text-muted">{tr.data.notice}</p>}
          {tr.data?.status === "NO_CANDIDATES" && <p className="text-sm">조건에 맞는 환승 후보가 없어요.</p>}
        </div>
      )}
    </div>
  );
}

function StationLocation({ r, which }: { r: Reservation; which: "origin" | "destination" }) {
  const name = which === "origin" ? r.origin_station_name : r.destination_station_name;
  const has = which === "origin" ? r.origin_lat != null : r.destination_lat != null;
  const [open, setOpen] = useState(false);
  const cands = useQuery({
    queryKey: ["station-loc", name], enabled: open,
    queryFn: () => api.get<{ candidates: { name: string; lat: number; lon: number; osm_id: string; zone: string }[] }>(`/api/rail/station-locations?${qs({ name })}`),
  });
  const save = useTripMutation((c: { lat: number; lon: number }) => api.patch(`/api/rail-reservations/${r.id}`, {
    version: r.version, [`${which}_lat`]: c.lat, [`${which}_lon`]: c.lon }));
  return (
    <div className="text-xs">
      {has ? <span className="text-ok">📍 {name}역 위치 지정됨 (OSM)</span> : (
        <>
          <button className="text-coral font-semibold min-h-9" onClick={() => setOpen(!open)}>📍 {name}역 지도 위치 지정</button>
          {open && (
            <div className="mt-1 space-y-1">
              {cands.data?.candidates.length === 0 && <p className="text-muted">보행 네트워크 범위 안에서 같은 이름의 OSM 역을 찾지 못했어요.</p>}
              {cands.data?.candidates.map((c) => (
                <button key={c.osm_id} className="btn btn-outline text-xs !min-h-9 mr-1" onClick={() => save.mutate(c)}>{c.name} ({c.zone})</button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function MyTrains() {
  const tripId = useTripId()!;
  const q = useReservations(tripId);
  const [manual, setManual] = useState(false);
  const [m, setM] = useState({ origin: "", destination: "", date: "", dep: "", arr: "", train_type: "", train_no: "" });
  const setStatus = useTripMutation((x: { r: Reservation; s: string }) => api.patch(`/api/rail-reservations/${x.r.id}`, { version: x.r.version, reservation_status: x.s }));
  const del = useTripMutation((r: Reservation) => api.del(`/api/rail-reservations/${r.id}`));
  const add = useTripMutation(() => api.post(`/api/trips/${tripId}/rail-reservations`, {
    origin_station_name: m.origin, destination_station_name: m.destination, travel_date: m.date || null,
    scheduled_departure: m.date && m.dep ? `${m.date}T${m.dep}:00+09:00` : null,
    scheduled_arrival: m.date && m.arr ? `${m.date}T${m.arr}:00+09:00` : null,
    train_type: m.train_type || null, train_number: m.train_no || null, from_timetable: false,
  }), () => setManual(false));

  return (
    <div className="space-y-3">
      {q.isLoading && <ListSkeleton rows={2} />}
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.data?.length === 0 && <EmptyState icon="🚆" title="기록한 열차가 없어요" body="시간표에서 고르거나 직접 기록해 보세요." />}
      {q.data?.map((r) => (
        <div key={r.id} className={`card p-4 ${r.reservation_status === "CANCELLED" ? "opacity-50" : ""}`}>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted">{md(r.travel_date)} · {r.train_type ?? "열차"} {r.train_number ?? ""}</p>
              <p className="font-bold">{hm(r.scheduled_departure)} {r.origin_station_name} → {hm(r.scheduled_arrival)} {r.destination_station_name}</p>
            </div>
            <SourceBadge status={r.schedule_source === "TAGO_TIMETABLE" ? "SCHEDULED" : "USER_ENTERED"} provider={r.schedule_source} at={r.schedule_checked_at} />
          </div>
          <div className="flex gap-1.5 mt-2" role="radiogroup" aria-label="예매 상태">
            {([["PLANNED", "예매 전"], ["RESERVED", "예매 완료"], ["CANCELLED", "취소"]] as const).map(([v, l]) => (
              <button key={v} role="radio" aria-checked={r.reservation_status === v} onClick={() => setStatus.mutate({ r, s: v })}
                className={`flex-1 min-h-10 rounded-xl text-sm font-semibold border ${r.reservation_status === v ? (v === "RESERVED" ? "bg-ok text-white border-ok" : "bg-navy text-white border-navy") : "bg-paper border-line"}`}>{l}</button>
            ))}
          </div>
          {r.reservation_status === "PLANNED" && <p className="text-xs text-warn mt-1">아직 예매하지 않은 열차예요. 내일로 패스가 있어도 좌석은 따로 예약해야 해요.</p>}
          <div className="mt-2 space-y-1"><StationLocation r={r} which="origin" /><StationLocation r={r} which="destination" /></div>
          <div className="flex gap-2 mt-2">
            <a href={KORAIL} target="_blank" rel="noreferrer" className="btn btn-outline text-sm flex-1">코레일 예매 ↗</a>
            <button className="btn text-sm text-bad bg-[#FFEEF0]" onClick={() => confirm("이 열차 기록을 삭제할까요?") && del.mutate(r)}>삭제</button>
          </div>
        </div>
      ))}
      <InlineError error={setStatus.error ?? del.error} />
      {manual ? (
        <form className="card p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined); }}>
          <p className="font-bold">열차 직접 기록</p>
          <Notice>직접 입력한 시각은 '직접 입력'으로 표시되고 공식 시간표로 확인된 것으로 취급하지 않아요.</Notice>
          <div className="grid grid-cols-2 gap-3">
            <input className="field" required placeholder="출발역" value={m.origin} onChange={(e) => setM({ ...m, origin: e.target.value })} />
            <input className="field" required placeholder="도착역" value={m.destination} onChange={(e) => setM({ ...m, destination: e.target.value })} />
            <input className="field" type="date" aria-label="날짜" value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} />
            <input className="field" placeholder="열차 종류 (KTX 등)" value={m.train_type} onChange={(e) => setM({ ...m, train_type: e.target.value })} />
            <label className="text-xs text-muted">출발<input className="field" type="time" value={m.dep} onChange={(e) => setM({ ...m, dep: e.target.value })} /></label>
            <label className="text-xs text-muted">도착<input className="field" type="time" value={m.arr} onChange={(e) => setM({ ...m, arr: e.target.value })} /></label>
            <input className="field col-span-2" placeholder="열차 번호" value={m.train_no} onChange={(e) => setM({ ...m, train_no: e.target.value })} />
          </div>
          <InlineError error={add.error} />
          <div className="flex gap-2"><button type="button" className="btn btn-ghost flex-1" onClick={() => setManual(false)}>취소</button>
            <button className="btn btn-primary flex-1" disabled={add.isPending}>저장</button></div>
        </form>
      ) : <button className="btn btn-outline w-full" onClick={() => setManual(true)}>+ 열차 직접 기록</button>}
    </div>
  );
}

export function PassPanel() {
  const tripId = useTripId()!;
  const q = usePass(tripId);
  if (q.isLoading) return <ListSkeleton rows={2} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const p = q.data!;
  const label = { SELECT_3: "선택 3일권", CONTINUOUS_7: "연속 7일권", UNDECIDED: "미정" }[p.pass_type] ?? p.pass_type;
  return (
    <div className="space-y-3">
      <div className="card p-5">
        <p className="text-sm text-muted">내일로 패스</p>
        <p className="text-xl font-bold">{label}</p>
        <p className="mt-2">열차 탑승일 <b className="text-2xl">{p.rail_day_count}</b>일{p.allowed_days ? ` / 패스로 쓸 수 있는 날 ${p.allowed_days}일` : ""}</p>
        <p className="text-sm text-navy-soft">예매 전 열차 {p.unreserved_trains}편</p>
      </div>
      {p.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
      <div className="card divide-y divide-line">
        {p.rail_days.length === 0 && <p className="p-4 text-sm text-muted">기록된 열차가 없어요.</p>}
        {p.rail_days.map((d, i) => (
          <div key={i} className="p-3">
            <p className="font-semibold">{d.date ? md(d.date) : "날짜 없는 기록"}</p>
            {d.trains.map((t) => <p key={t.id} className="text-sm text-navy-soft">{t.train} {t.route}</p>)}
          </div>
        ))}
      </div>
      <Notice>{p.disclaimer} <a className="underline" href={p.official_url} target="_blank" rel="noreferrer">코레일 공식 안내</a></Notice>
    </div>
  );
}
