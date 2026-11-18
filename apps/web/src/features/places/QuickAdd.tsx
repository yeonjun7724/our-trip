import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { CATEGORY_LABEL, CITY_LABEL, PREF_LABEL } from "@/services/format";
import { useTripId, useTripMutation } from "@/services/queries";
import type { City, Place, Pref } from "@/services/types";
import { InlineError, Sheet } from "@/components/ui";

const CENTERS: [City, number, number][] = [["busan", 35.15, 129.07], ["gyeongju", 35.83, 129.21], ["pohang", 36.03, 129.37]];

function guessCity(lat: number, lon: number): City {
  let best: City = "other", d = Infinity;
  for (const [c, a, b] of CENTERS) {
    const x = (lat - a) ** 2 + ((lon - b) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (x < d) { d = x; best = c; }
  }
  return Math.sqrt(d) * 111 < 40 ? best : "other";
}

/** Tap on the map -> add a place right there (coordinate_source USER_PICKED). */
export default function QuickAdd({ at, onClose, onSaved }: { at: { lat: number; lon: number } | null; onClose: () => void; onSaved: (id: string) => void }) {
  const tripId = useTripId()!;
  const [f, setF] = useState({ name: "", city: "busan" as City, category: "ATTRACTION", preference: "" as Pref | "" });
  useEffect(() => { if (at) setF((x) => ({ ...x, name: "", city: guessCity(at.lat, at.lon) })); }, [at]);
  const save = useTripMutation(() => api.post<{ place: Place }>(`/api/trips/${tripId}/places`, {
    name: f.name.trim(), city: f.city, category: f.category, preference: f.preference || null,
    latitude: at!.lat, longitude: at!.lon, coordinate_source: "USER_PICKED",
  }), (r) => onSaved(r.place.id));
  return (
    <Sheet open={!!at} onClose={onClose} title="여기에 장소 추가">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) save.mutate(undefined); }}>
        <input className="field" autoFocus required maxLength={120} placeholder="장소 이름" aria-label="장소 이름"
          value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <select className="field" aria-label="도시" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value as City })}>
            {(["busan", "gyeongju", "pohang", "other"] as City[]).map((c) => <option key={c} value={c}>{CITY_LABEL[c]}</option>)}
          </select>
          <select className="field" aria-label="분류" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {(["MUST", "GOOD", "MAYBE", "SKIP"] as Pref[]).map((p) => (
            <button type="button" key={p} onClick={() => setF({ ...f, preference: f.preference === p ? "" : p })}
              className={`min-h-11 rounded-xl text-[13px] font-semibold border ${f.preference === p ? "bg-coral text-white border-coral" : "bg-paper border-line"}`}>{PREF_LABEL[p]}</button>
          ))}
        </div>
        <p className="text-xs text-muted">위치: 지도에서 직접 선택 ({at?.lat.toFixed(5)}, {at?.lon.toFixed(5)})</p>
        <InlineError error={save.error} />
        <button className="btn btn-primary w-full h-12" disabled={!f.name.trim() || save.isPending}>{save.isPending ? "저장 중…" : "저장"}</button>
      </form>
    </Sheet>
  );
}
