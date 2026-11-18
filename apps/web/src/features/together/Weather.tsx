import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { ago, todayKST } from "@/services/format";
import type { Day } from "@/services/types";

interface WDay { date: string; code: number; tmax: number; tmin: number; rain: number | null }
interface WRes { cities: Record<string, { days: WDay[]; fetched_at?: string; error?: string }>; attribution: string }

// WMO weather codes → emoji + label
export function wmo(code: number): [string, string] {
  if (code === 0) return ["☀️", "맑음"];
  if (code <= 2) return ["🌤️", "구름 조금"];
  if (code === 3) return ["☁️", "흐림"];
  if (code <= 48) return ["🌫️", "안개"];
  if (code <= 57) return ["🌦️", "이슬비"];
  if (code <= 67) return ["🌧️", "비"];
  if (code <= 77) return ["🌨️", "눈"];
  if (code <= 82) return ["🌧️", "소나기"];
  if (code <= 86) return ["🌨️", "눈 소나기"];
  return ["⛈️", "뇌우"];
}

/** Forecast for each trip day in that day's city (Open-Meteo, ≤16 days ahead). Falls back to the next 3 days. */
export default function WeatherCard({ days }: { days: Day[] }) {
  const q = useQuery({ queryKey: ["weather"], queryFn: () => api.get<WRes>("/api/weather"), staleTime: 30 * 60_000 });
  if (q.isLoading) return <div className="skeleton h-28" />;
  if (q.error || !q.data) return null;
  if (Object.values(q.data.cities).every((c) => c.error)) {
    return <p className="text-xs text-muted px-1">🌤️ 지금은 날씨 예보를 불러오지 못했어요.</p>;
  }
  const dated = days.filter((d) => d.travel_date && d.primary_city !== "other");
  const rows = dated.length
    ? dated.map((d) => ({ label: `DAY ${d.day_number}`, city: d.primary_city, cityLabel: d.primary_city_label,
        w: q.data!.cities[d.primary_city]?.days.find((x) => x.date === d.travel_date) }))
    : (["busan", "gyeongju", "pohang"] as const).map((c) => ({ label: "오늘", city: c, cityLabel: { busan: "부산", gyeongju: "경주", pohang: "포항" }[c],
        w: q.data!.cities[c]?.days.find((x) => x.date === todayKST()) }));
  const fetched = Object.values(q.data.cities).find((c) => c.fetched_at)?.fetched_at;
  return (
    <section className="card p-5">
      <div className="flex items-center mb-3"><h2 className="text-[17px] font-bold tracking-[-0.025em] flex-1">{dated.length ? "여행 날씨" : "지금 날씨"}</h2>
        <span className="text-[11px] text-muted">Open-Meteo 예보{fetched ? ` · ${ago(fetched)}` : ""}</span></div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(rows.length, 4)}, minmax(0,1fr))` }}>
        {rows.slice(0, 4).map((r, i) => (
          <div key={i} className="rounded-[16px] bg-gradient-to-b from-[#EDF2FF] to-[#F7F5F1] py-3 flex flex-col items-center gap-0.5 text-center">
            <span className="text-[11px] font-bold text-coral">{r.label}</span>
            <span className="text-xs text-navy-soft">{r.cityLabel}</span>
            {r.w ? (<>
              <span className="text-2xl leading-tight" title={wmo(r.w.code)[1]}>{wmo(r.w.code)[0]}</span>
              <span className="text-sm font-bold">{Math.round(r.w.tmax)}° <span className="text-muted font-normal">{Math.round(r.w.tmin)}°</span></span>
              {r.w.rain != null && <span className="text-[11px] text-sea">💧{r.w.rain}%</span>}
            </>) : <span className="text-[11px] text-muted mt-2 px-1">예보 범위 밖</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
