import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { CATEGORY_ICON, CATEGORY_LABEL, CITY_COLOR, CITY_LABEL } from "@/services/format";
import { useTripId, useTripMutation } from "@/services/queries";
import type { City, Place, Pref } from "@/services/types";
import { InlineError, Sheet } from "@/components/ui";
import { toast } from "@/components/Toast";

const CENTERS: [City, number, number][] = [["busan", 35.15, 129.07], ["gyeongju", 35.83, 129.21], ["pohang", 36.03, 129.37]];
const PREFS: { v: Pref; e: string; l: string }[] = [
  { v: "MUST", e: "😍", l: "꼭 가고 싶어" }, { v: "GOOD", e: "🙂", l: "가면 좋아" }, { v: "MAYBE", e: "🤔", l: "고민 중" }, { v: "SKIP", e: "🙅", l: "이번엔 제외" },
];

function guessCity(lat: number, lon: number): City {
  let best: City = "other", d = Infinity;
  for (const [c, a, b] of CENTERS) {
    const x = (lat - a) ** 2 + ((lon - b) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (x < d) { d = x; best = c; }
  }
  return Math.sqrt(d) * 111 < 40 ? best : "other";
}

export interface QuickAddInit { lat: number; lon: number; name?: string; source?: "USER_PICKED" | "OSM_NOMINATIM"; osm_ref?: string }

/** Tap on the map (or pick an OSM search hit) → add the place right there. */
export default function QuickAdd({ init, onClose, onSaved }: { init: QuickAddInit | null; onClose: () => void; onSaved: (id: string) => void }) {
  const tripId = useTripId()!;
  const [f, setF] = useState({ name: "", city: "busan" as City, category: "ATTRACTION", preference: "" as Pref | "" });
  useEffect(() => { if (init) setF((x) => ({ ...x, name: init.name ?? "", city: guessCity(init.lat, init.lon) })); }, [init]);
  const save = useTripMutation(() => api.post<{ place: Place; possible_duplicates: { name: string }[] }>(`/api/trips/${tripId}/places`, {
    name: f.name.trim(), city: f.city, category: f.category, preference: f.preference || null,
    latitude: init!.lat, longitude: init!.lon, coordinate_source: init!.source ?? "USER_PICKED", osm_ref: init!.osm_ref ?? null,
  }), (r) => {
    toast(r.possible_duplicates.length ? `저장했어요 · 비슷한 장소 '${r.possible_duplicates[0].name}'가 있어요` : `'${r.place.name}' 저장했어요`,
      r.possible_duplicates.length ? "warn" : "ok");
    onSaved(r.place.id);
  });
  return (
    <Sheet open={!!init} onClose={onClose} backdrop={false} title={<span className="flex items-center gap-2">📍 여기에 장소 추가</span>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) save.mutate(undefined); }}>
        <input className="field !text-lg !min-h-12 font-semibold" autoFocus required maxLength={120} placeholder="어떤 곳인가요? (예: 해리단길 카페)" aria-label="장소 이름"
          value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div>
          <p className="label">분류</p>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {Object.entries(CATEGORY_LABEL).filter(([k]) => k !== "STATION").map(([k, v]) => (
              <button type="button" key={k} onClick={() => setF({ ...f, category: k })}
                className={`shrink-0 min-h-10 px-3 rounded-full text-sm font-semibold border flex items-center gap-1 ${f.category === k ? "bg-navy text-white border-navy" : "bg-paper border-line"}`}>
                <span>{CATEGORY_ICON[k]}</span>{v}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="label">내 마음</p>
          <div className="grid grid-cols-4 gap-1.5">
            {PREFS.map((p) => (
              <button type="button" key={p.v} onClick={() => setF({ ...f, preference: f.preference === p.v ? "" : p.v })}
                className={`min-h-14 rounded-2xl text-[12px] font-semibold border flex flex-col items-center justify-center gap-0.5 transition-colors ${f.preference === p.v ? "bg-coral text-white border-coral" : "bg-paper border-line"}`}>
                <span className="text-lg leading-none">{p.e}</span>{p.l}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">도시</span>
          {(["busan", "gyeongju", "pohang", "other"] as City[]).map((c) => (
            <button type="button" key={c} onClick={() => setF({ ...f, city: c })}
              className={`min-h-9 px-3 rounded-full font-semibold border ${f.city === c ? "text-white border-transparent" : "bg-paper border-line"}`}
              style={f.city === c ? { background: c === "other" ? "#7D8597" : CITY_COLOR[c] } : undefined}>{CITY_LABEL[c]}</button>
          ))}
        </div>
        <p className="text-xs text-muted">위치: {init?.source === "OSM_NOMINATIM" ? "OpenStreetMap 검색 결과" : "지도에서 직접 선택"}</p>
        <InlineError error={save.error} />
        <button className="btn btn-primary w-full h-14 text-lg" disabled={!f.name.trim() || save.isPending}>{save.isPending ? "저장 중…" : "저장"}</button>
      </form>
    </Sheet>
  );
}
