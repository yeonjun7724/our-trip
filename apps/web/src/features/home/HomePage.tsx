import { Link } from "react-router-dom";
import Icon, { type IconName } from "@/components/Icon";
import { Avatar, ErrorState, ListSkeleton, Notice } from "@/components/ui";
import { useActivity, useItinerary, usePass, usePlaces, useReservations, useTrip, useTripId } from "@/services/queries";
import { ago, dday, hm, md, todayKST } from "@/services/format";
import WeatherCard from "@/features/together/Weather";
import { useExpenses } from "@/features/together/ExpensesPage";
import { useChecklist } from "@/features/together/ChecklistPage";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const pct = (n: number, d: number) => `${d ? Math.round((n / d) * 100) : 0}%`;
const shortDate = (iso: string | null) => (iso ? `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}` : "");

function ddayLine(start: string | null) {
  const d = dday(start);
  if (!d) return null;
  if (d === "D-DAY") return "오늘 떠나요!";
  return d.startsWith("D-") ? `여행까지 ${d}` : d;
}

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
  const focusNo = focusDay?.day_number;
  const placeEntries = days.flatMap((d) => d.entries.filter((e) => e.kind === "PLACE"));
  const visited = placeEntries.filter((e) => e.visit_status === "VISITED").length;
  const nextPlace = focusDay?.entries.find((e) => e.kind === "PLACE" && e.visit_status === "PLANNED");
  const upcoming = (res.data ?? []).filter((r) => r.reservation_status !== "CANCELLED" && r.scheduled_departure && new Date(r.scheduled_departure) > new Date())
    .sort((a, b) => a.scheduled_departure!.localeCompare(b.scheduled_departure!));
  const nextTrain = upcoming[0];
  const reserved = (res.data ?? []).filter((r) => r.reservation_status === "RESERVED").length;
  const planned = (res.data ?? []).filter((r) => r.reservation_status === "PLANNED").length;
  const both = (places.data ?? []).filter((p) => p.both_want).length;
  const placeCount = places.data?.length ?? 0;
  const idx = Object.fromEntries(t.members.map((m, i) => [m.id, i]));
  const myName = t.members.find((m) => m.is_me)?.nickname;
  const done = checklist.filter((c) => c.done).length;
  const line = ddayLine(t.start_date);
  const transfer = money?.transfers[0];

  const menu: { icon: IconName; fg: string; bg: string; title: string; sub: string; to: string; value?: string }[] = [
    { icon: "heart", fg: "#F04452", bg: "#FFEEF0", title: "위시리스트", sub: `${placeCount}곳 · 둘 다 원하는 곳 ${both}곳`, to: "/wishlist" },
    { icon: "sparkle", fg: "#03B26C", bg: "#E5F8EF", title: "같이 쓴 돈", to: "/expenses", value: won(money?.total ?? 0),
      sub: transfer ? `${transfer.from_name} → ${transfer.to_name} ${won(transfer.amount)}` : "정산할 금액 없음" },
    { icon: "check", fg: "#F08A00", bg: "#FFF3E0", title: "여행 준비", to: "/checklist", value: checklist.length ? pct(done, checklist.length) : undefined,
      sub: checklist.length ? `${checklist.length}개 중 ${done}개 완료` : "체크리스트를 만들어 보세요" },
    { icon: "train", fg: "#3182F6", bg: "#E8F3FF", title: "철도 예약 · 내일로", to: "/transit?tab=mine",
      sub: `예매 완료 ${reserved} · 예매 전 ${planned}${pass.data ? ` · 탑승 ${pass.data.rail_day_count}${pass.data.allowed_days ? `/${pass.data.allowed_days}` : ""}일` : ""}` },
  ];

  return (
    <div className="page space-y-3">
      <header className="flex items-center gap-2 h-11 -mt-1">
        <span className="flex-1 font-bold text-[19px] tracking-[-0.03em]">Our Trip</span>
        <Link to="/settings" className="tap rounded-full text-[#B0B8C1] active:bg-line flex items-center justify-center" aria-label="여행 설정">
          <Icon name="settings" size={24} />
        </Link>
      </header>

      {/* greeting — Toss-style big text, no banner */}
      <section className="px-1 pt-2 pb-3">
        <p className="text-[15px] text-navy-soft font-medium">
          {myName ? `${myName}님, ` : ""}{t.start_date ? `${md(t.start_date)} 출발 · ${t.days.length - 1}박 ${t.days.length}일` : "출발 날짜를 정해 주세요"}
        </p>
        <h1 className="text-[26px] leading-[1.38] font-bold tracking-[-0.03em] mt-1">
          {t.title}
          {line && <><br /><span className="text-coral">{line}</span></>}
        </h1>
      </section>

      {/* trip card: day stepper + progress */}
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold tracking-[-0.02em]">여행 일정</h2>
          <Link to="/itinerary" className="text-[14px] text-muted font-medium flex items-center min-h-9 active:opacity-60">자세히<Icon name="chevronR" size={16} /></Link>
        </div>
        <ol className="grid mt-4" style={{ gridTemplateColumns: `repeat(${Math.max(t.days.length, 1)}, minmax(0, 1fr))` }} aria-label="날짜별 도시">
          {t.days.map((d, i) => {
            const on = d.day_number === focusNo;
            return (
              <li key={d.id} className="relative flex flex-col items-center">
                {i > 0 && <span className="absolute top-[15px] right-1/2 w-full h-[2px] bg-line" aria-hidden />}
                <Link to="/itinerary" className="relative flex flex-col items-center gap-1.5 active:opacity-60" aria-label={`DAY ${d.day_number} ${d.primary_city_label}`}>
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[14px] font-bold num ${on ? "bg-coral text-white" : "bg-[#E5E8EB] text-navy-soft"}`}>{d.day_number}</span>
                  <span className={`text-[14px] font-semibold ${on ? "text-navy" : "text-navy-soft"}`}>{d.primary_city_label}</span>
                  <span className="text-[12px] text-muted num leading-none">{shortDate(d.travel_date) || "날짜 미정"}</span>
                </Link>
              </li>
            );
          })}
        </ol>
        <div className="mt-5 pt-4 border-t border-line">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] text-navy-soft">방문한 곳</span>
            <span className="text-[15px] font-bold num">{visited}<span className="text-muted font-medium"> / {placeEntries.length}곳</span></span>
          </div>
          <div className="h-2 rounded-full bg-sand overflow-hidden mt-2">
            <div className="h-full bg-coral rounded-full transition-all duration-700" style={{ width: pct(visited, placeEntries.length) }} />
          </div>
        </div>
      </section>

      {/* today */}
      <section className="card p-5">
        <h2 className="text-[17px] font-bold tracking-[-0.02em]">
          {todayDay ? "오늘 일정" : "첫날 일정"}
          {focusDay && <span className="text-muted font-medium"> · DAY {focusDay.day_number} {focusDay.primary_city_label}</span>}
        </h2>
        {it.isLoading ? <div className="skeleton h-16 mt-3" /> : focusDay && focusDay.entries.length ? (
          <ol className="mt-2">
            {focusDay.entries.slice(0, 5).map((e) => {
              const v = e.visit_status === "VISITED";
              return (
                <li key={e.item_id} className={`flex items-center gap-3.5 py-2.5 ${v ? "opacity-45" : ""}`}>
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center text-[17px] shrink-0 ${e.kind === "RAIL" ? "bg-sand" : "bg-coral-soft text-coral font-bold"}`}>
                    {e.kind === "RAIL" ? "🚆" : v ? "✓" : "📍"}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[16px] font-semibold truncate ${v ? "line-through" : ""}`}>{e.kind === "RAIL" ? `${e.origin} → ${e.destination}` : e.name}</span>
                    <span className="block text-[13px] text-muted num">{e.kind === "RAIL" ? `${e.departure ?? "–"} 출발` : e.start ? `${e.start} 예정` : "시간 미정"}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <Link to="/wishlist" className="mt-3 flex items-center gap-3 rounded-[14px] bg-sand px-4 py-4 active:bg-line transition-colors">
            <span className="flex-1">
              <span className="block text-[15px] font-semibold">아직 넣은 장소가 없어요</span>
              <span className="block text-[13px] text-muted mt-0.5">위시리스트에서 날짜를 골라 보세요</span>
            </span>
            <Icon name="chevronR" size={18} className="text-[#B0B8C1]" />
          </Link>
        )}
      </section>

      {/* next up */}
      <div className="grid grid-cols-2 gap-3">
        <section className="card p-5">
          <p className="text-[13px] text-muted font-medium">다음 방문</p>
          <p className="text-[17px] font-bold mt-1.5 truncate">{nextPlace?.name ?? "없음"}</p>
          <p className="text-[13px] text-navy-soft mt-0.5 num">{nextPlace?.start ? `${nextPlace.start} 예정` : nextPlace ? "시간 미정" : " "}</p>
        </section>
        <Link to="/transit?tab=mine" className="card p-5 block">
          <p className="text-[13px] text-muted font-medium">다음 열차</p>
          {nextTrain ? (
            <>
              <p className="text-[17px] font-bold mt-1.5 truncate num">{hm(nextTrain.scheduled_departure)} {nextTrain.origin_station_name}</p>
              <p className="text-[13px] text-navy-soft mt-0.5 truncate">{nextTrain.destination_station_name}행 · {nextTrain.status_label}</p>
            </>
          ) : (
            <>
              <p className="text-[17px] font-bold mt-1.5">없음</p>
              <p className="text-[13px] text-coral font-medium mt-0.5">시간표 보기</p>
            </>
          )}
        </Link>
      </div>

      {/* Toss-style menu list */}
      <ul className="card py-2">
        {menu.map((m) => (
          <li key={m.title}>
            <Link to={m.to} className="flex items-center gap-3.5 px-5 py-3 min-h-[68px] active:bg-[#F9FAFB] transition-colors">
              <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: m.bg, color: m.fg }}><Icon name={m.icon} size={20} stroke={2.2} /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-[16px] font-semibold">{m.title}</span>
                <span className="block text-[13px] text-muted truncate">{m.sub}</span>
              </span>
              {m.value && <span className="text-[16px] font-bold num shrink-0">{m.value}</span>}
              <Icon name="chevronR" size={18} className="text-[#B0B8C1] shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
      {pass.data?.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}

      <WeatherCard days={t.days} />

      <section className="card pt-5 pb-2">
        <h2 className="text-[17px] font-bold tracking-[-0.02em] px-5">최근 활동</h2>
        {act.isLoading ? <div className="px-5 py-3"><ListSkeleton rows={2} /></div> : act.data?.length ? (
          <ul className="mt-2">
            {act.data.slice(0, 6).map((a) => {
              const m = t.members.find((x) => x.nickname === a.member);
              return (
                <li key={a.id} className="px-5 py-3 flex gap-3.5 items-center">
                  {a.member ? <Avatar name={a.member} index={m ? idx[m.id] : 0} size={36} /> : <span className="w-9" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] leading-snug">{a.summary}</span>
                    <span className="block text-[13px] text-muted mt-0.5">{ago(a.created_at)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : <p className="px-5 py-6 text-[15px] text-muted">아직 활동이 없어요</p>}
      </section>
    </div>
  );
}
