import { Link } from "react-router-dom";
import Icon from "@/components/Icon";
import { Avatar, EmptyState, ErrorState, ListSkeleton, Notice } from "@/components/ui";
import { useActivity, useItinerary, usePass, usePlaces, useReservations, useTrip, useTripId } from "@/services/queries";
import { ago, CITY_COLOR, dday, hm, md, todayKST } from "@/services/format";

export default function HomePage() {
  const tripId = useTripId();
  const trip = useTrip(tripId);
  const it = useItinerary(tripId);
  const res = useReservations(tripId);
  const act = useActivity(tripId);
  const pass = usePass(tripId);
  const places = usePlaces(tripId);

  if (trip.isLoading) return <div className="page"><ListSkeleton rows={4} /></div>;
  if (trip.error) return <div className="page"><ErrorState error={trip.error} retry={() => trip.refetch()} /></div>;
  const t = trip.data!;
  const today = todayKST();
  const days = it.data?.days ?? [];
  const todayDay = days.find((d) => d.travel_date === today);
  const focusDay = todayDay ?? days[0];
  const placeEntries = days.flatMap((d) => d.entries.filter((e) => e.kind === "PLACE"));
  const visited = placeEntries.filter((e) => e.visit_status === "VISITED").length;
  const nextPlace = focusDay?.entries.find((e) => e.kind === "PLACE" && e.visit_status === "PLANNED");
  const upcoming = (res.data ?? []).filter((r) => r.reservation_status !== "CANCELLED" && r.scheduled_departure && new Date(r.scheduled_departure) > new Date())
    .sort((a, b) => a.scheduled_departure!.localeCompare(b.scheduled_departure!));
  const nextTrain = upcoming[0];
  const reserved = (res.data ?? []).filter((r) => r.reservation_status === "RESERVED").length;
  const planned = (res.data ?? []).filter((r) => r.reservation_status === "PLANNED").length;
  const both = (places.data ?? []).filter((p) => p.both_want).length;
  const idx = Object.fromEntries(t.members.map((m, i) => [m.id, i]));

  return (
    <div className="page space-y-4">
      {/* hero */}
      <section className="hero-grad rounded-[28px] p-5 text-white shadow-float relative overflow-hidden">
        <div className="absolute -right-6 -top-6 w-32 h-32 rounded-full bg-white/15" aria-hidden />
        <div className="absolute right-10 bottom-[-30px] w-20 h-20 rounded-full bg-white/10" aria-hidden />
        <div className="flex items-start gap-3 relative">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/85">{t.start_date ? `${md(t.start_date)} 출발` : "날짜 미정 · 설정에서 정할 수 있어요"}</p>
            <h1 className="text-[26px] leading-tight font-extrabold mt-0.5">{t.title}</h1>
          </div>
          <Link to="/settings" className="tap rounded-full bg-white/20 flex items-center justify-center" aria-label="여행 설정"><Icon name="settings" /></Link>
        </div>
        <div className="flex items-end gap-3 mt-4 relative">
          <div className="flex -space-x-2 shrink-0">
            {t.members.slice(0, 4).map((m, i) => <Avatar key={m.id} name={m.nickname} index={i} size={34} ring />)}
            {t.members.length > 4 && <span className="w-[34px] h-[34px] rounded-full bg-white/30 ring-2 ring-paper text-xs font-bold flex items-center justify-center">+{t.members.length - 4}</span>}
          </div>
          <span className="text-sm text-white/90 min-w-0 flex-1 truncate">{t.members.map((m) => m.nickname).join(" · ") || "아직 아무도 없어요"}</span>
          {dday(t.start_date) && <span className="ml-auto rounded-full bg-white text-coral font-extrabold px-3 py-1">{dday(t.start_date)}</span>}
        </div>
        <div className="mt-4 relative">
          <div className="flex justify-between text-xs text-white/90 mb-1"><span>방문 {visited} / 일정 {placeEntries.length}곳</span><span>💕 둘 다 원하는 곳 {both}</span></div>
          <div className="h-2 rounded-full bg-white/25 overflow-hidden">
            <div className="h-full bg-white rounded-full transition-all" style={{ width: `${placeEntries.length ? (visited / placeEntries.length) * 100 : 0}%` }} />
          </div>
        </div>
      </section>

      {/* quick actions */}
      <div className="grid grid-cols-4 gap-2">
        {([["map", "지도", "/"], ["heart", "위시", "/wishlist"], ["train", "열차", "/transit"], ["bus", "정류장", "/transit?tab=stops"]] as const).map(([i, l, to]) => (
          <Link key={l} to={to} className="card py-3 flex flex-col items-center gap-1 text-xs font-semibold active:bg-sand">
            <span className="w-10 h-10 rounded-2xl bg-coral-soft text-coral flex items-center justify-center"><Icon name={i} /></span>{l}
          </Link>
        ))}
      </div>

      {/* today */}
      <section className="card p-4">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: focusDay ? CITY_COLOR[focusDay.primary_city] : "#ccc" }} />
          <h2 className="font-bold flex-1">{todayDay ? "오늘" : "첫날 미리보기"} · {focusDay ? `DAY ${focusDay.day_number} ${focusDay.primary_city_label}` : "–"}</h2>
          <Link to="/itinerary" className="text-sm text-coral font-semibold min-h-11 flex items-center">전체<Icon name="chevronR" size={16} /></Link>
        </div>
        {it.isLoading ? <div className="skeleton h-16 mt-3" /> : focusDay && focusDay.entries.length ? (
          <ol className="mt-2 relative">
            <span className="absolute left-[54px] top-2 bottom-2 w-0.5 bg-line" aria-hidden />
            {focusDay.entries.slice(0, 6).map((e) => (
              <li key={e.item_id} className={`flex items-center gap-3 py-1.5 text-sm ${e.visit_status === "VISITED" ? "opacity-50" : ""}`}>
                <span className="w-11 shrink-0 font-mono text-navy-soft text-right">{e.kind === "RAIL" ? e.departure ?? "–" : e.start ?? "–:–"}</span>
                <span className={`w-3 h-3 rounded-full border-2 border-paper relative z-10 ${e.kind === "RAIL" ? "bg-navy" : e.visit_status === "VISITED" ? "bg-ok" : "bg-coral"}`} />
                <span className={`flex-1 truncate ${e.visit_status === "VISITED" ? "line-through" : ""}`}>{e.kind === "RAIL" ? `🚆 ${e.origin}→${e.destination}` : e.name}</span>
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted mt-2">아직 배정된 장소가 없어요. 위시리스트에서 날짜를 골라 보세요.</p>}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <section className="card p-4">
          <p className="text-xs text-muted font-semibold flex items-center gap-1"><Icon name="pin" size={14} />다음 방문</p>
          <p className="font-bold mt-1 truncate">{nextPlace?.name ?? "–"}</p>
          <p className="text-xs text-navy-soft mt-0.5">{nextPlace?.start ? `${nextPlace.start} 예정 (추정)` : nextPlace ? "시간 미확인" : ""}</p>
        </section>
        <section className="card p-4">
          <p className="text-xs text-muted font-semibold flex items-center gap-1"><Icon name="train" size={14} />다음 열차</p>
          {nextTrain ? (
            <>
              <p className="font-bold mt-1 truncate">{hm(nextTrain.scheduled_departure)} {nextTrain.origin_station_name}</p>
              <p className="text-xs text-navy-soft mt-0.5 truncate">→ {nextTrain.destination_station_name} · {nextTrain.status_label}</p>
            </>
          ) : <p className="text-sm text-muted mt-1">예정된 열차 없음</p>}
        </section>
      </div>

      <Link to="/transit?tab=mine" className="card p-4 block">
        <div className="flex items-center"><h2 className="font-bold flex-1">철도 예약 · 내일로</h2><Icon name="chevronR" className="text-muted" /></div>
        <div className="flex gap-2 mt-2 text-sm">
          <span className="chip bg-[#E9F5EE] text-ok">예매 완료 {reserved}</span>
          <span className={`chip ${planned ? "bg-[#FFF4E0] text-warn" : "bg-sand"}`}>예매 전 {planned}</span>
          {pass.data && <span className="chip bg-sand">탑승일 {pass.data.rail_day_count}{pass.data.allowed_days ? `/${pass.data.allowed_days}` : ""}일</span>}
        </div>
        {pass.data?.warnings.map((w) => <div className="mt-2" key={w}><Notice tone="warn">{w}</Notice></div>)}
      </Link>

      <section>
        <h2 className="font-bold mb-2">최근 활동</h2>
        {act.isLoading ? <ListSkeleton rows={2} /> : act.data?.length ? (
          <ul className="card divide-y divide-line">
            {act.data.slice(0, 8).map((a) => {
              const m = t.members.find((x) => x.nickname === a.member);
              return (
                <li key={a.id} className="px-4 py-3 text-sm flex gap-3 items-center">
                  {a.member ? <Avatar name={a.member} index={m ? idx[m.id] : 0} size={26} /> : <span className="w-[26px]" />}
                  <span className="flex-1">{a.summary}</span>
                  <span className="text-xs text-muted shrink-0">{ago(a.created_at)}</span>
                </li>
              );
            })}
          </ul>
        ) : <EmptyState title="아직 활동이 없어요" />}
      </section>
    </div>
  );
}
