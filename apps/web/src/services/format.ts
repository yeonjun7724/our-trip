import type { City, DataStatus, Pref } from "./types";

export const CITY_LABEL: Record<City, string> = { busan: "부산", gyeongju: "경주", pohang: "포항", other: "기타" };
export const CITY_COLOR: Record<City, string> = { busan: "#2F6FDE", gyeongju: "#B5651D", pohang: "#0F8B8D", other: "#7D8597" };

export const PREF_LABEL: Record<Pref, string> = { MUST: "꼭 가고 싶어", GOOD: "가면 좋아", MAYBE: "고민 중", SKIP: "이번에는 제외" };
export const PREF_SHORT: Record<Pref, string> = { MUST: "꼭!", GOOD: "좋아", MAYBE: "고민", SKIP: "제외" };
export const PREF_STYLE: Record<Pref, string> = {
  MUST: "bg-coral text-white", GOOD: "bg-coral-soft text-coral", MAYBE: "bg-sand text-navy-soft", SKIP: "bg-line text-muted",
};

export const CATEGORY_LABEL: Record<string, string> = {
  ATTRACTION: "관광지", CAFE: "카페", FOOD: "음식점", LODGING: "숙소", SHOPPING: "쇼핑", STATION: "역", ETC: "기타",
};
export const CATEGORY_ICON: Record<string, string> = {
  ATTRACTION: "📸", CAFE: "☕", FOOD: "🍜", LODGING: "🛏️", SHOPPING: "🛍️", STATION: "🚉", ETC: "•",
};

export const STATUS_LABEL: Record<DataStatus, string> = {
  USER_ENTERED: "직접 입력", VERIFIED_STATIC: "정적 정보", SCHEDULED: "시간표", LIVE: "실시간",
  ESTIMATED: "추정", UNAVAILABLE: "조회 불가", STALE: "오래된 정보",
};

export const PROVIDER_LABEL: Record<string, string> = {
  OSMNX: "OSMnx 계산", ODSAY: "ODsay", TAGO: "TAGO", OSM: "OpenStreetMap", USER: "직접 입력",
  TAGO_TIMETABLE: "TAGO 시간표", USER_ENTERED: "직접 입력", NOMINATIM: "OSM 검색",
};

export const MODE_LABEL: Record<string, string> = {
  WALK: "도보", BUS: "버스", SUBWAY: "지하철", TRAIN: "열차", EXPRESS_BUS: "고속버스", INTERCITY_BUS: "시외버스",
  AIR: "항공", FERRY: "배", TRANSIT: "대중교통", TAXI_EXTERNAL: "택시", UNKNOWN: "이동",
};

export function km(m: number | null | undefined) {
  if (m === null || m === undefined) return "–";
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

export function minutes(m: number | null | undefined) {
  if (m === null || m === undefined) return "미확인";
  const r = Math.round(m);
  return r < 60 ? `${r}분` : `${Math.floor(r / 60)}시간 ${r % 60 ? `${r % 60}분` : ""}`.trim();
}

const KST = "Asia/Seoul";
export function hm(iso: string | null | undefined) {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: KST });
}
export function md(iso: string | null | undefined) {
  if (!iso) return "날짜 미정";
  const d = iso.length === 10 ? new Date(iso + "T00:00:00+09:00") : new Date(iso);
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: KST });
}
export function ago(iso: string | null | undefined) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
export function todayKST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: KST });
}
export function dday(start: string | null): string | null {
  if (!start) return null;
  const a = new Date(todayKST() + "T00:00:00+09:00").getTime();
  const b = new Date(start + "T00:00:00+09:00").getTime();
  const d = Math.round((b - a) / 86400000);
  return d > 0 ? `D-${d}` : d === 0 ? "D-DAY" : `여행 ${-d + 1}일째`;
}
