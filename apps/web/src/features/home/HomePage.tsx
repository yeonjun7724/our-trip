import { Link } from "react-router-dom";
import Icon from "@/components/Icon";
import { Avatar, EmptyState, ErrorState, ListSkeleton, Notice } from "@/components/ui";
import { useActivity, useItinerary, usePass, usePlaces, useReservations, useTrip, useTripId } from "@/services/queries";
import { ago, CITY_COLOR, dday, hm, md, todayKST } from "@/services/format";
import WeatherCard from "@/features/together/Weather";
import { useExpenses } from "@/features/together/ExpensesPage";
import { useChecklist } from "@/features/together/ChecklistPage";

export default function HomePage() {
  const tripId = useTripId();
  const trip = useTrip(tripId);
  const it = useItinerary(tripId);
  const res = useReservations(tripId);
  const act = useActivity(tripId);
  const pass = usePass(tripId);
  const places = usePlaces(tripId);
  const money = useExpenses(tripId).data;
  const checklist = useChecklist(tripId).data ?? [];

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

  const focusNo = focusDay?.day_number;
  const shortDate = (iso: string | null) => (iso ? `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}` : "");
  const route = t.days.reduce<string[]>((acc, d) => (acc[acc.length - 1] === d.primary_city_label ? acc : [...acc, d.primary_city_label ?? ""]), []);
  const pct = (n: number, d: number) => `${d ? Math.round((n / d) * 100) : 0}%`;
  const done = checklist.filter((c) => c.done).length;

  return (
    <div className="page space-y-3.5">
      {/* top bar */}
      <header className="flex items-center gap-2 -mb-0.5">
        <span className="flex items-center gap-2 flex-1 min-w-0">
          <img src="/icons/icon.svg" alt="" className="w-7 h-7 rounded-[9px]" />
          <span className="font-[800] text-[17px] tracking-[-0.03em]">Our Trip</span>
        </span>
        <Link to="/settings" className="tap rounded-full text-navy-soft active:bg-line flex items-center justify-center" aria-label="여행 설정"><Icon name="settings" /></Link>
      </header>

      {/* hero ticket */}
      <section className="ticket">
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[12px] font-bold tracking-[.12em] text-white/60">RAIL PASS · {t.days.length - 1}박 {t.days.length}일</p>
            {dday(t.start_date) && <span className="shrink-0 rounded-full bg-sunset text-white font-[800] text-[13px] px-3 py-1 shadow-[0_4px_14px_-4px_rgba(255,107,61,.8)]">{dday(t.start_date)}</span>}
          </div>
          <h1 className="text-[27px] leading-[1.22] font-[800] tracking-[-0.035em] mt-2.5">{t.title}</h1>
          <p className="text-[15px] font-semibold text-white/80 mt-1.5 flex items-center flex-wrap gap-x-1.5">
            {route.map((c, i) => <span key={i} className="flex items-center gap-1.5">{i > 0 && <span className="text-sunset">→</span>}{c}</span>)}
          </p>
          <div className="flex items-center gap-2.5 mt-4">
            <div className="flex -space-x-1.5 shrink-0">
              {t.members.slice(0, 4).map((m, i) => <span key={m.id} className="rounded-full ring-2 ring-[#1B1E38]"><Avatar name={m.nickname} index={i} size={28} /></span>)}
              {t.members.length > 4 && <span className="w-7 h-7 rounded-full bg-white/15 ring-2 ring-[#1B1E38] text-xs font-bold flex items-center justify-center">+{t.members.length - 4}</span>}
            </div>
            <span className="text-[14px] text-white/70 min-w-0 flex-1 truncate">{t.members.map((m) => m.nickname).join(" · ") || "아직 아무도 없어요"}</span>
            <span className="text-[13px] text-white/60 shrink-0">{t.start_date ? `${md(t.start_date)} 출발` : "날짜 미정"}</span>
          </div>
        </div>
        <div className="ticket-tear" aria-hidden />
        <div className="px-4 pt-5 pb-5">
          <ol className="rail" aria-label="날짜별 도시">
            {t.days.map((d) => (
              <li key={d.id} className={`rail-stop ${d.day_number === focusNo ? "on" : ""}`}>
                <Link to="/itinerary" className="flex flex-col items-center gap-1.5" aria-label={`DAY ${d.day_number} ${d.primary_city_label}`}>
                  <span className="rail-dot num">{d.day_number}</span>
                  <span className="text-[14px] font-bold leading-none">{d.primary_city_label}</span>
                  <span className="text-[11px] text-white/55 leading-none num">{shortDate(d.travel_date) || `DAY ${d.day_number}`}</span>
                </Link>
              </li>
            ))}
          </ol>
          <div className="grid grid-cols-3 mt-5 rounded-[18px] bg-white/[.07] ring-1 ring-white/10 divide-x divide-white/10">
            {([
              ["방문", `${visited}`, `/${placeEntries.length}`],
              ["둘 다 원해요", `${both}`, "곳"],
              ["열차 탑승", `${pass.data?.rail_day_count ?? 0}`, pass.data?.allowed_days ? `/${pass.data.allowed_days}일` : "일"],
            ] as const).map(([l, v, u]) => (
              <div key={l} className="px-3 py-3 text-center">
                <p className="text-[11.5px] text-white/55 font-medium">{l}</p>
                <p className="text-[20px] font-[800] mt-0.5 num leading-tight">{v}<span className="text-[13px] font-semibold text-white/55">{u}</span></p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* quick actions */}
      <div className="grid grid-cols-4 gap-2.5">
        {([
          ["heart", "위시", "/wishlist", "#FF5A7A", "#FFEDF1"], ["train", "열차", "/transit", "#4F46E5", "#EEEFFF"],
          ["sparkle", "가계부", "/expenses", "#0E9F6E", "#E5F7EF"], ["check", "체크리스트", "/checklist", "#DB7600", "#FFF2E2"],
        ] as const).map(([i, l, to, fg, bg]) => (
          <Link key={l} to={to} className="card py-3.5 flex flex-col items-center gap-2 text-[13px] font-semibold text-navy-soft">
            <span className="w-11 h-11 rounded-[15px] flex items-center justify-center" style={{ background: bg, color: fg }}><Icon name={i} size={22} stroke={2.2} /></span>{l}
          </Link>
        ))}
      </div>

      <WeatherCard days={t.days} />

      {/* today */}
      <section className="card p-5">
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-[13px] flex items-center justify-center text-white font-[800] num shrink-0" style={{ background: focusDay ? CITY_COLOR[focusDay.primary_city] : "#B2B3BF" }}>{focusDay?.day_number ?? "–"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-muted">{todayDay ? "오늘의 일정" : "첫날 미리보기"}</p>
            <h2 className="text-[18px] font-bold tracking-[-0.025em] truncate">{focusDay ? `DAY ${focusDay.day_number} · ${focusDay.primary_city_label}` : "–"}</h2>
          </div>
          <Link to="/itinerary" className="text-sm text-coral font-semibold min-h-11 flex items-center">전체<Icon name="chevronR" size={16} /></Link>
        </div>
        {it.isLoading ? <div className="skeleton h-16 mt-3" /> : focusDay && focusDay.entries.length ? (
          <ol className="mt-2 relative">
            <span className="absolute left-[54px] top-3 bottom-3 w-0.5 bg-line rounded-full" aria-hidden />
            {focusDay.entries.slice(0, 6).map((e) => (
              <li key={e.item_id} className={`flex items-center gap-3 py-1.5 text-sm ${e.visit_status === "VISITED" ? "opacity-50" : ""}`}>
                <span className="w-11 shrink-0 num font-semibold text-navy-soft text-right">{e.kind === "RAIL" ? e.departure ?? "–" : e.start ?? "–:–"}</span>
                <span className={`w-3 h-3 rounded-full border-2 border-paper relative z-10 ${e.kind === "RAIL" ? "bg-navy" : e.visit_status === "VISITED" ? "bg-ok" : "bg-coral"}`} />
                <span className={`flex-1 truncate ${e.visit_status === "VISITED" ? "line-through" : ""}`}>{e.kind === "RAIL" ? `🚆 ${e.origin}→${e.destination}` : e.name}</span>
              </li>
            ))}
          </ol>
        ) : (
          <Link to="/wishlist" className="mt-3 flex items-center gap-3 rounded-[16px] border border-dashed border-[#D6D2CB] px-4 py-3.5 text-[14px] text-navy-soft active:bg-sand">
            <span className="text-xl">🗺️</span><span className="flex-1">아직 배정된 장소가 없어요.<br /><b className="text-coral">위시리스트에서 날짜 고르기</b></span><Icon name="chevronR" size={18} className="text-muted" />
          </Link>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <section className="card p-5">
          <p className="text-xs text-muted font-semibold flex items-center gap-1"><Icon name="pin" size={14} className="text-sunset" />다음 방문</p>
          <p className="font-bold mt-1 truncate">{nextPlace?.name ?? "–"}</p>
          <p className="text-xs text-navy-soft mt-0.5">{nextPlace?.start ? `${nextPlace.start} 예정 (추정)` : nextPlace ? "시간 미확인" : ""}</p>
        </section>
        <section className="card p-5">
          <p className="text-xs text-muted font-semibold flex items-center gap-1"><Icon name="train" size={14} className="text-coral" />다음 열차</p>
          {nextTrain ? (
            <>
              <p className="font-bold mt-1 truncate">{hm(nextTrain.scheduled_departure)} {nextTrain.origin_station_name}</p>
              <p className="text-xs text-navy-soft mt-0.5 truncate">→ {nextTrain.destination_station_name} · {nextTrain.status_label}</p>
            </>
          ) : <p className="text-sm text-muted mt-1">예정된 열차 없음</p>}
        </section>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/expenses" className="card p-5 block">
          <p className="text-[12px] text-muted font-semibold">💸 같이 쓴 돈</p>
          <p className="font-[800] text-[21px] mt-1 num tracking-[-0.02em]">{(money?.total ?? 0).toLocaleString("ko-KR")}<span className="text-[15px] font-semibold text-navy-soft">원</span></p>
          <p className="text-xs text-navy-soft mt-0.5 truncate">{money?.transfers[0] ? `${money.transfers[0].from_name} → ${money.transfers[0].to_name} ${money.transfers[0].amount.toLocaleString("ko-KR")}원` : "정산할 금액 없음"}</p>
        </Link>
        <Link to="/checklist" className="card p-5 block">
          <p className="text-[12px] text-muted font-semibold">🎒 여행 준비</p>
          <p className="font-[800] text-[21px] mt-1 num">{done}<span className="text-[15px] font-semibold text-navy-soft"> / {checklist.length}</span></p>
          <div className="h-1.5 rounded-full bg-sand mt-2 overflow-hidden"><div className="h-full rounded-full bg-[linear-gradient(90deg,#4F46E5,#FF6B3D)] transition-all duration-500" style={{ width: pct(done, checklist.length) }} /></div>
        </Link>
      </div>

      <Link to="/transit?tab=mine" className="card p-5 block">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-[13px] bg-navy text-white flex items-center justify-center shrink-0"><Icon name="train" size={20} /></span>
          <h2 className="text-[17px] font-bold tracking-[-0.025em] flex-1">철도 예약 · 내일로</h2><Icon name="chevronR" className="text-muted" />
        </div>
        <div className="flex gap-1.5 mt-3 text-sm flex-wrap">
          <span className="chip bg-[#E5F8EF] text-ok">예매 완료 {reserved}</span>
          <span className={`chip ${planned ? "bg-[#FFF3E0] text-warn" : "bg-sand"}`}>예매 전 {planned}</span>
          {pass.data && <span className="chip bg-coral-soft text-coral-ink">탑승일 {pass.data.rail_day_count}{pass.data.allowed_days ? `/${pass.data.allowed_days}` : ""}일</span>}
        </div>
        {pass.data?.warnings.map((w) => <div className="mt-2" key={w}><Notice tone="warn">{w}</Notice></div>)}
      </Link>

      <section>
        <h2 className="sec-title mb-3 mt-2 px-1">최근 활동</h2>
        {act.isLoading ? <ListSkeleton rows={2} /> : act.data?.length ? (
          <ul className="card divide-y divide-line">
            {act.data.slice(0, 8).map((a) => {
              const m = t.members.find((x) => x.nickname === a.member);
              return (
                <li key={a.id} className="px-4 py-3.5 text-[14px] flex gap-3 items-center">
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
