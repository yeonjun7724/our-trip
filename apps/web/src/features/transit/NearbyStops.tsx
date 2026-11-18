import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/services/api";
import { ago, km, minutes } from "@/services/format";
import type { Freshness, Stop } from "@/services/types";
import { ErrorState, ListSkeleton, Notice, Segmented, SourceBadge } from "@/components/ui";

export interface NearbyResponse { stops: Stop[]; source_notes: string[]; providers: Record<string, string>; radius_m: number }

const KIND_ICON = { BUS: "🚌", SUBWAY: "🚇", RAIL: "🚆" } as const;
const KIND_LABEL = { BUS: "버스정류장", SUBWAY: "지하철역", RAIL: "철도역" } as const;
const RADII = [300, 500, 800, 1000];

export function useNearby(lat?: number | null, lon?: number | null, radius = 500, enabled = true) {
  return useQuery({
    queryKey: ["nearby", lat?.toFixed(5), lon?.toFixed(5), radius],
    queryFn: () => api.get<NearbyResponse>(`/api/transit/stops/nearby?${qs({ lat, lon, radius })}`),
    enabled: enabled && lat != null && lon != null, staleTime: 5 * 60_000,
  });
}

interface ArrivalsRes {
  status: string; message?: string | null; freshness: Freshness;
  arrivals: { route_no: string | null; route_type: string | null; arrival_seconds: number | null; remaining_stops: number | null; vehicle_type: string | null }[];
}

function Arrivals({ stop }: { stop: Stop }) {
  const q = useQuery({
    queryKey: ["arrivals", stop.key],
    queryFn: () => api.get<ArrivalsRes>(`/api/transit/stops/${stop.key}/arrivals`),
    staleTime: 15_000, refetchInterval: false,
  });
  const routes = useQuery({
    queryKey: ["stop-routes", stop.key], enabled: stop.key.startsWith("TAGO:"), staleTime: 3600_000,
    queryFn: () => api.get<{ routes: string[] | null }>(`/api/transit/stops/${stop.key}/routes`),
  });
  const fetched = q.data?.freshness.fetched_at;
  const stale = fetched && Date.now() - new Date(fetched).getTime() > 120_000;
  return (
    <div className="mt-2 rounded-xl bg-ivory p-3">
      {routes.data?.routes && routes.data.routes.length > 0 && (
        <p className="text-xs text-navy-soft mb-2">경유 노선: {routes.data.routes.join(", ")}</p>
      )}
      {q.isLoading && <div className="skeleton h-10" />}
      {q.data && q.data.status !== "OK" && <p className="text-sm text-navy-soft">{q.data.message}</p>}
      {q.data?.status === "OK" && (
        <>
          <ul className="space-y-1">
            {q.data.arrivals.map((a, i) => (
              <li key={i} className="flex text-sm gap-2">
                <b className="w-16 shrink-0">{a.route_no ?? "?"}</b>
                <span className="flex-1">{a.arrival_seconds != null ? `약 ${Math.max(1, Math.round(a.arrival_seconds / 60))}분 후` : "시간 정보 없음"}
                  {a.remaining_stops != null && <span className="text-muted"> · {a.remaining_stops}정류장 전</span>}</span>
                {a.vehicle_type && <span className="text-xs text-muted">{a.vehicle_type}</span>}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 mt-2">
            <SourceBadge status={stale ? "STALE" : "LIVE"} provider="TAGO" at={fetched} />
            <button className="text-sm text-coral font-semibold min-h-11 px-2" onClick={() => q.refetch()} disabled={q.isFetching}>
              {q.isFetching ? "조회 중…" : "새로고침"}
            </button>
          </div>
          <p className="text-[11px] text-muted mt-1">공급자 예측값이며 실제 도착을 보장하지 않아요.</p>
        </>
      )}
      {q.data && q.data.status !== "OK" && q.data.freshness.fetched_at && (
        <p className="text-[11px] text-muted mt-1">{ago(q.data.freshness.fetched_at)} 확인</p>
      )}
    </div>
  );
}

export default function NearbyStops({ lat, lon, onStops, onSelectStop }: {
  lat: number; lon: number; onStops?: (s: Stop[]) => void; onSelectStop?: (s: Stop) => void;
}) {
  const [radius, setRadius] = useState(500);
  const [open, setOpen] = useState<string | null>(null);
  const q = useNearby(lat, lon, radius);
  if (q.data && onStops) queueMicrotask(() => onStops(q.data!.stops));
  return (
    <div>
      <Segmented size="sm" value={String(radius)} onChange={(v) => setRadius(Number(v))}
        options={RADII.map((r) => ({ value: String(r), label: r < 1000 ? `${r}m` : "1km" }))} />
      <div className="mt-3 space-y-2">
        {q.isLoading && <ListSkeleton rows={2} />}
        {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
        {q.data?.source_notes.map((n) => <Notice key={n}>{n}</Notice>)}
        {q.data && q.data.stops.length === 0 && <p className="text-sm text-muted">반경 안에 확인된 정류장이 없어요.</p>}
        {q.data?.stops.slice(0, 20).map((s) => {
          const realtime = s.sources.some((x) => x.provider === "TAGO" && x.realtime_supported === true);
          const unknownRt = s.sources.some((x) => x.provider === "TAGO" && x.realtime_supported === null);
          return (
            <div key={s.key} className="card p-3">
              <button className="w-full text-left flex gap-3 items-start" onClick={() => { setOpen(open === s.key ? null : s.key); onSelectStop?.(s); }}>
                <span className="text-xl" aria-hidden>{KIND_ICON[s.kind]}</span>
                <span className="flex-1 min-w-0">
                  <span className="font-semibold block truncate">{s.name ?? "(이름 없음)"}</span>
                  <span className="text-xs text-muted">{KIND_LABEL[s.kind]}{s.stop_number ? ` · ${s.stop_number}` : ""} · 직선 {km(s.straight_distance_m)}</span>
                  <span className="text-sm block mt-0.5">
                    {s.walk_status === "OK" ? <>도보 <b>{km(s.walk_distance_m)}</b> · {minutes(s.walk_minutes)}</> :
                      s.walk_status === "NO_PATH" ? "보행 네트워크상 경로 없음" : "실제 도보거리 계산 불가 (보행망 범위 밖)"}
                  </span>
                  <span className="flex flex-wrap gap-1 mt-1">
                    {s.walk_status === "OK" && <SourceBadge status="ESTIMATED" provider="OSMNX" />}
                    {s.sources.map((x) => <span key={x.provider + x.stop_id} className="chip bg-sand text-navy-soft">{x.provider} {x.stop_id}</span>)}
                    {s.kind === "BUS" && <span className={`chip ${realtime ? "bg-[#E9F5EE] text-ok" : "bg-line text-muted"}`}>
                      {realtime ? "실시간 도착정보" : unknownRt ? "실시간 지원 미확인" : "실시간 없음"}</span>}
                  </span>
                </span>
              </button>
              {open === s.key && s.kind === "BUS" && <Arrivals stop={s} />}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted mt-2">정류장 위치: TAGO 버스정류소정보 / © OpenStreetMap contributors. 반경은 후보 검색 기준이고 실제 거리는 보행 네트워크로 계산해요.</p>
    </div>
  );
}
