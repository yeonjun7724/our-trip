import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/services/api";
import { km, MODE_LABEL, minutes } from "@/services/format";
import type { RouteOption, TransitResult } from "@/services/types";
import type { RouteFeature } from "@/components/MapView";
import { Notice, Segmented, SourceBadge } from "@/components/ui";

const MODE_ICON: Record<string, string> = { WALK: "🚶", BUS: "🚌", SUBWAY: "🚇", TRAIN: "🚆", EXPRESS_BUS: "🚍", INTERCITY_BUS: "🚍" };

export function routeFeatures(o: RouteOption, extra?: RouteFeature[]): RouteFeature[] {
  const f: RouteFeature[] = [];
  o.legs.forEach((l) => { if (l.geometry) f.push({ geometry: l.geometry, mode: l.mode, color: l.line_color }); });
  return [...f, ...(extra ?? [])];
}

export function TransitSearchButton({ origin, destination, departureAt, onResult }: {
  origin: { lat: number; lon: number; label?: string }; destination: { lat: number; lon: number; label?: string };
  departureAt?: string | null; onResult: (r: TransitResult) => void;
}) {
  const m = useMutation({
    mutationFn: () => api.post<TransitResult>("/api/transit/routes", { origin, destination, departure_at: departureAt || null }),
    onSuccess: onResult,
  });
  return (
    <button className="btn btn-outline flex-1" disabled={m.isPending} onClick={() => m.mutate()}>
      {m.isPending ? "조회 중…" : "🚌 대중교통 경로"}
    </button>
  );
}

export default function TransitResults({ result, onShow, onPick, pickLabel }: {
  result: TransitResult; onShow?: (f: RouteFeature[]) => void; onPick?: (o: RouteOption) => void; pickLabel?: string;
}) {
  const [sort, setSort] = useState<"time" | "transfers" | "walk">("time");
  const geo = useMutation({
    mutationFn: (o: RouteOption) => api.post<{ status: string; message?: string; geometry: { features: { geometry: RouteFeature["geometry"]; properties: { mode: string } }[] } | null }>(
      "/api/transit/routes/geometry", { map_obj: o.geometry_ref }),
  });
  if (result.status !== "OK") {
    return (
      <div className="space-y-2">
        <Notice tone={result.status === "NOT_CONFIGURED" ? "info" : "warn"}>{result.message}</Notice>
        {result.external_links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {result.external_links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="btn btn-outline text-sm">{l.label} ↗</a>)}
          </div>
        )}
      </div>
    );
  }
  const inf = Number.POSITIVE_INFINITY;
  const opts = [...result.options].sort((a, b) =>
    sort === "transfers" ? (a.transfer_count ?? inf) - (b.transfer_count ?? inf) || (a.total_minutes ?? inf) - (b.total_minutes ?? inf)
      : sort === "walk" ? (a.walk_distance_m ?? inf) - (b.walk_distance_m ?? inf)
      : (a.total_minutes ?? inf) - (b.total_minutes ?? inf));
  return (
    <div className="space-y-2">
      {result.time_basis_note && <Notice tone="warn">{result.time_basis_note}</Notice>}
      <Segmented size="sm" value={sort} onChange={setSort}
        options={[{ value: "time", label: "소요시간" }, { value: "transfers", label: "환승 적은" }, { value: "walk", label: "도보 적은" }]} />
      {opts.map((o) => (
        <div key={o.option_id} className="card p-3">
          <div className="flex items-baseline gap-2">
            <b className="text-lg">{minutes(o.total_minutes)}</b>
            <span className="text-sm text-navy-soft">환승 {o.transfer_count ?? "–"}회 · 도보 {km(o.walk_distance_m)}{o.fare_krw != null ? ` · ${o.fare_krw.toLocaleString()}원` : ""}</span>
          </div>
          <ol className="mt-2 space-y-1">
            {o.legs.map((l, i) => (
              <li key={i} className="text-sm flex gap-2">
                <span aria-hidden>{MODE_ICON[l.mode] ?? "•"}</span>
                <span className="flex-1">
                  {l.mode === "WALK" ? `도보 ${km(l.distance_m)}` :
                    <><b>{l.line_name ?? MODE_LABEL[l.mode]}</b> {l.start_name} → {l.end_name}{l.stop_count ? ` (${l.stop_count}정거장)` : ""}</>}
                </span>
                <span className="text-muted shrink-0">{minutes(l.duration_minutes)}</span>
              </li>
            ))}
          </ol>
          <div className="flex gap-2 mt-2">
            {onShow && (
              <button className="btn btn-ghost text-sm flex-1" disabled={geo.isPending} onClick={async () => {
                const own = routeFeatures(o);
                if (o.geometry_ref) {
                  try {
                    const g = await geo.mutateAsync(o);
                    const ride = (g.geometry?.features ?? []).map((f) => ({ geometry: f.geometry, mode: f.properties.mode }));
                    onShow([...own, ...ride]);
                    return;
                  } catch { /* fall through: show only verified walk geometry */ }
                }
                onShow(own);
              }}>지도에 보기</button>
            )}
            {onPick && <button className="btn btn-primary text-sm flex-1" onClick={() => onPick(o)}>{pickLabel ?? "선택"}</button>}
          </div>
          {geo.data && geo.data.status !== "OK" && <p className="text-xs text-muted mt-1">노선 모양을 불러오지 못해 정류장 연결만 표시해요.</p>}
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        <SourceBadge status={result.freshness.status} provider={result.provider} at={result.freshness.fetched_at} />
        {result.attribution && <span className="text-[11px] text-muted">{result.attribution}</span>}
      </div>
    </div>
  );
}
