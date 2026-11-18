import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePlaces, useTripId } from "@/services/queries";
import type { TransitResult } from "@/services/types";
import MapView, { type RouteFeature } from "@/components/MapView";
import { Header, Notice, Segmented } from "@/components/ui";
import { MyTrains, PassPanel, RailSearch } from "@/features/rail/Rail";
import NearbyStops from "./NearbyStops";
import TransitResults, { TransitSearchButton } from "./TransitResults";

type Tab = "rail" | "mine" | "stops" | "route" | "pass";

function usePoint() {
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const locate = () => {
    setErr(null);
    navigator.geolocation?.getCurrentPosition((p) => setPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => setErr("현재 위치를 가져오지 못했어요. 장소를 골라 주세요."), { enableHighAccuracy: true, timeout: 10000 });
  };
  return { pos, err, locate };
}

function PointSelect({ label, value, onChange, me }: { label: string; value: string; onChange: (v: string) => void; me: boolean }) {
  const places = usePlaces(useTripId()).data?.filter((p) => p.has_location) ?? [];
  return (
    <div>
      <label className="label">{label}</label>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">선택</option>
        {me && <option value="me">현재 위치</option>}
        {places.map((p) => <option key={p.id} value={p.id}>{p.city_label} · {p.name}</option>)}
      </select>
    </div>
  );
}

function RouteSearch() {
  const places = usePlaces(useTripId()).data ?? [];
  const { pos, err, locate } = usePoint();
  const [o, setO] = useState("");
  const [d, setD] = useState("");
  const [when, setWhen] = useState("");
  const [res, setRes] = useState<TransitResult | null>(null);
  const [routes, setRoutes] = useState<RouteFeature[]>([]);
  const pt = (id: string) => {
    if (id === "me") return pos ? { ...pos, label: "현재 위치" } : null;
    const p = places.find((x) => x.id === id);
    return p?.has_location ? { lat: p.latitude!, lon: p.longitude!, label: p.name } : null;
  };
  const origin = pt(o), dest = pt(d);
  const fit = useMemo(() => routes.length ? routes.flatMap((r) => r.geometry.coordinates.map(([x, y]) => [y, x] as [number, number])) : null, [routes]);
  return (
    <div className="space-y-3">
      <div className="card p-5 space-y-3">
        <PointSelect label="출발" value={o} onChange={(v) => { setO(v); if (v === "me") locate(); setRes(null); }} me />
        {err && <p className="text-sm text-bad">{err}</p>}
        <PointSelect label="도착" value={d} onChange={(v) => { setD(v); setRes(null); }} me={false} />
        <div><label className="label" htmlFor="dt">출발 희망 시각 (선택)</label>
          <input id="dt" type="datetime-local" className="field" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
        <p className="text-xs text-muted">ODsay 경로 검색은 출발시각 지정을 지원하지 않아 결과는 조회 시점 기준이에요. 버튼을 누를 때만 조회해요(호출 한도 보호).</p>
        <div className="flex">{origin && dest ? <TransitSearchButton origin={origin} destination={dest}
          departureAt={when ? `${when}:00+09:00` : null} onResult={(r) => { setRes(r); setRoutes([]); }} /> :
          <button className="btn btn-outline flex-1" disabled>🚌 대중교통 경로</button>}</div>
      </div>
      {routes.length > 0 && (
        <div className="h-64 rounded-2xl overflow-hidden border border-line">
          <MapView markers={[]} routes={routes} fit={fit} showLocate={false} />
        </div>
      )}
      {res && <TransitResults result={res} onShow={setRoutes} />}
    </div>
  );
}

function StopsTab() {
  const { pos, err, locate } = usePoint();
  const places = usePlaces(useTripId()).data?.filter((p) => p.has_location) ?? [];
  const [sel, setSel] = useState("");
  const p = places.find((x) => x.id === sel);
  const at = sel === "me" ? pos : p ? { lat: p.latitude!, lon: p.longitude! } : null;
  return (
    <div className="space-y-3">
      <div className="card p-5">
        <label className="label" htmlFor="sb">기준 위치</label>
        <select id="sb" className="field" value={sel} onChange={(e) => { setSel(e.target.value); if (e.target.value === "me") locate(); }}>
          <option value="">선택</option><option value="me">현재 위치</option>
          {places.map((x) => <option key={x.id} value={x.id}>{x.city_label} · {x.name}</option>)}
        </select>
        {err && <p className="text-sm text-bad mt-1">{err}</p>}
      </div>
      {at ? <NearbyStops lat={at.lat} lon={at.lon} /> : <Notice>현재 위치나 장소를 고르면 주변 버스정류장·지하철역을 보여드려요.</Notice>}
    </div>
  );
}

export default function TransitPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "rail";
  return (
    <div className="page">
      <Header eyebrow="기차 · 버스 · 지하철" title="교통" sub="열차 시간표 · 주변 정류장 · 대중교통 경로" />
      <Segmented value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} options={[
        { value: "rail", label: "열차 시간표" }, { value: "mine", label: "내 열차" }, { value: "stops", label: "주변 정류장" },
        { value: "route", label: "경로 검색" }, { value: "pass", label: "내일로" }]} />
      <div className="mt-4">
        {tab === "rail" && <RailSearch />}
        {tab === "mine" && <MyTrains />}
        {tab === "stops" && <StopsTab />}
        {tab === "route" && <RouteSearch />}
        {tab === "pass" && <PassPanel />}
      </div>
    </div>
  );
}
