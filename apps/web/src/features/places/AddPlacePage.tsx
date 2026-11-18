import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/services/api";
import { CATEGORY_LABEL, CITY_LABEL, PREF_LABEL } from "@/services/format";
import { useTripId, useTripMutation } from "@/services/queries";
import type { City, Place, Pref } from "@/services/types";
import { Header, InlineError, Notice } from "@/components/ui";
import LocationPicker, { type PickedLocation } from "@/components/LocationPicker";

interface LinkInfo {
  valid: boolean; reason?: string; provider?: "NAVER" | "KAKAO"; url?: string; resolved_url?: string | null;
  provider_place_id?: string | null; name_hint?: string | null; address_hint?: string | null; identified?: boolean; message: string;
}

export default function AddPlacePage() {
  const tripId = useTripId()!;
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [text, setText] = useState(params.get("text") ?? "");
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [f, setF] = useState({ name: "", city: "busan" as City, category: "ATTRACTION", memo: "", preference: "" as Pref | "" });
  const [loc, setLoc] = useState<PickedLocation | null>(null);
  const [picker, setPicker] = useState(false);
  const [dups, setDups] = useState<{ name: string; reason: string }[] | null>(null);

  const check = useMutation({
    mutationFn: (t: string) => api.post<LinkInfo>("/api/links/validate", { text: t }),
    onSuccess: (r) => {
      setInfo(r);
      if (r.name_hint && !f.name) setF((x) => ({ ...x, name: r.name_hint!.slice(0, 120) }));
      const addr = r.address_hint ?? "";
      if (/경주/.test(addr)) setF((x) => ({ ...x, city: "gyeongju" }));
      else if (/포항/.test(addr)) setF((x) => ({ ...x, city: "pohang" }));
      else if (/부산/.test(addr)) setF((x) => ({ ...x, city: "busan" }));
    },
  });
  useEffect(() => { if (params.get("text")) check.mutate(params.get("text")!); }, []); // eslint-disable-line

  const save = useTripMutation(() => api.post<{ place: Place; possible_duplicates: { name: string; reason: string }[] }>(`/api/trips/${tripId}/places`, {
    name: f.name.trim(), city: f.city, category: f.category, memo: f.memo || null, preference: f.preference || null,
    latitude: loc?.lat ?? null, longitude: loc?.lon ?? null, coordinate_source: loc?.source ?? null, osm_ref: loc?.osm_ref ?? null,
    share_url: info?.valid ? info.url : null, provider_place_id: info?.valid ? info.provider_place_id : null,
  }), (r) => { if (r.possible_duplicates.length) setDups(r.possible_duplicates); else nav("/wishlist"); });

  const paste = async () => {
    try { const t = await navigator.clipboard.readText(); setText(t); check.mutate(t); } catch { /* iOS may block: user pastes manually */ }
  };

  return (
    <div className="page">
      <Header eyebrow="새 장소" title="장소 추가" help="addPlace" sub="네이버 지도·카카오맵 공유 링크를 붙여 넣거나 직접 입력해요" />
      <section className="card p-5">
        <label className="label" htmlFor="link">공유 링크 / 공유 문구</label>
        <textarea id="link" className="field min-h-20" value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"예) [네이버 지도]\n황리단길\nhttps://naver.me/..."} />
        <div className="flex gap-2 mt-2">
          <button className="btn btn-ghost flex-1" onClick={paste}>붙여넣기</button>
          <button className="btn btn-outline flex-1" disabled={!text.trim() || check.isPending} onClick={() => check.mutate(text)}>
            {check.isPending ? "확인 중…" : "링크 확인"}
          </button>
        </div>
        <InlineError error={check.error} />
        {info && (
          <div className="mt-3">
            <Notice tone={info.valid ? (info.identified ? "info" : "warn") : "warn"}>
              {info.valid && <b>{info.provider === "NAVER" ? "네이버 지도" : "카카오맵"} 링크 · </b>}{info.message}
            </Notice>
            {info.address_hint && <p className="text-xs text-muted mt-1">붙여 넣은 문구의 주소: {info.address_hint}</p>}
          </div>
        )}
        <p className="text-[11px] text-muted mt-2">링크는 북마크로만 저장해요. 외부 지도 페이지 내용은 가져오지 않으니 위치는 아래 지도에서 직접 지정해 주세요.</p>
      </section>

      <form className="space-y-4 mt-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <div><label className="label" htmlFor="nm">장소 이름</label>
          <input id="nm" className="field" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="ct">도시</label>
            <select id="ct" className="field" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value as City })}>
              {(["busan", "gyeongju", "pohang", "other"] as City[]).map((c) => <option key={c} value={c}>{CITY_LABEL[c]}</option>)}
            </select></div>
          <div><label className="label" htmlFor="cg">분류</label>
            <select id="cg" className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
        </div>
        <div>
          <span className="label">위치</span>
          {loc ? (
            <div className="card p-4 flex items-center gap-2">
              <span className="flex-1 text-sm">📍 {loc.label ?? `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}`}<br />
                <span className="text-xs text-muted">{loc.source === "OSM_NOMINATIM" ? "OpenStreetMap 검색 결과" : "지도에서 직접 선택"}</span></span>
              <button type="button" className="btn btn-ghost" onClick={() => setPicker(true)}>변경</button>
            </div>
          ) : (
            <button type="button" className="btn btn-outline w-full" onClick={() => setPicker(true)}>지도에서 위치 지정 (나중에 해도 돼요)</button>
          )}
        </div>
        <div>
          <span className="label">내 선호도</span>
          <div className="grid grid-cols-4 gap-1.5">
            {(["MUST", "GOOD", "MAYBE", "SKIP"] as Pref[]).map((p) => (
              <button type="button" key={p} onClick={() => setF({ ...f, preference: f.preference === p ? "" : p })}
                className={`min-h-11 rounded-xl text-[13px] font-semibold border ${f.preference === p ? "bg-coral text-white border-coral" : "bg-paper border-line"}`}>{PREF_LABEL[p]}</button>
            ))}
          </div>
        </div>
        <div><label className="label" htmlFor="mm">여행 메모</label>
          <textarea id="mm" className="field min-h-20" maxLength={2000} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></div>
        <InlineError error={save.error} />
        {dups ? (
          <div className="space-y-2">
            <Notice tone="warn">저장했어요. 비슷한 장소가 이미 있어요: {dups.map((d) => `${d.name}(${d.reason})`).join(", ")}. 자동으로 합치지 않았으니 위시리스트에서 확인해 주세요.</Notice>
            <button type="button" className="btn btn-primary w-full" onClick={() => nav("/wishlist")}>위시리스트로</button>
          </div>
        ) : (
          <button className="btn btn-primary w-full !min-h-14 text-[17px]" disabled={!f.name.trim() || save.isPending}>{save.isPending ? "저장 중…" : "위시리스트에 저장"}</button>
        )}
      </form>
      <LocationPicker open={picker} onClose={() => setPicker(false)} city={f.city} query={f.name} initial={loc} onPick={setLoc} />
    </div>
  );
}
