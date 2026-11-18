import { useState } from "react";
import { Link } from "react-router-dom";
import { usePlaces, useTrip, useTripId, useTripMutation } from "@/services/queries";
import { api } from "@/services/api";
import { toast } from "@/components/Toast";
import { CATEGORY_ICON, CITY_COLOR, CITY_LABEL, PREF_SHORT } from "@/services/format";
import type { City, Place } from "@/services/types";
import { Avatar, EmptyState, ErrorState, Header, ListSkeleton, Segmented, Sheet } from "@/components/ui";
import PlaceDetail, { PlaceTitle } from "@/features/places/PlaceDetail";

type Tab = "all" | "mine" | "partner" | "both" | "unassigned" | "assigned";

export default function WishlistPage() {
  const tripId = useTripId();
  const q = usePlaces(tripId);
  const [tab, setTab] = useState<Tab>("all");
  const [city, setCity] = useState<City | "all">("all");
  const [sel, setSel] = useState<string | null>(null);
  const [sort, setSort] = useState<"score" | "recent">("score");

  const list = (q.data ?? []).filter((p) => {
    if (city !== "all" && p.city !== city) return false;
    if (tab === "mine") return p.created_by_me;
    if (tab === "partner") return !p.created_by_me && !!p.created_by_id;
    if (tab === "both") return p.both_want;
    if (tab === "unassigned") return !p.planned_day;
    if (tab === "assigned") return !!p.planned_day;
    return true;
  }).sort((a, b) => sort === "score" ? b.priority_score - a.priority_score : b.updated_at.localeCompare(a.updated_at));
  const selected = q.data?.find((p) => p.id === sel);
  const trip = useTrip(tripId).data;
  const memberIdx = Object.fromEntries((trip?.members ?? []).map((m, i) => [m.id, i]));

  return (
    <div className="page">
      <Header title="위시리스트" sub={`${q.data?.length ?? 0}곳 · 둘 다 원하는 곳 ${q.data?.filter((p) => p.both_want).length ?? 0}곳`}
        right={<Link to="/places/new" className="btn btn-primary">+ 추가</Link>} />
      <Segmented value={tab} onChange={setTab} options={[
        { value: "all", label: "전체" }, { value: "both", label: "둘 다 💕" }, { value: "mine", label: "내가 추가" },
        { value: "partner", label: "상대가 추가" }, { value: "unassigned", label: "일정 미배정" }, { value: "assigned", label: "일정 확정" }]} />
      <div className="flex gap-2 mt-2 items-center">
        <Segmented size="sm" value={city} onChange={setCity} options={[
          { value: "all", label: "모든 도시" }, ...(["busan", "gyeongju", "pohang"] as City[]).map((c) => ({ value: c, label: CITY_LABEL[c] }))]} />
        <select className="field !w-auto !min-h-9 text-sm ml-auto" value={sort} onChange={(e) => setSort(e.target.value as never)} aria-label="정렬">
          <option value="score">추천순</option><option value="recent">최근 수정순</option>
        </select>
      </div>
      <div className="mt-4 space-y-2.5">
        {q.isLoading && <ListSkeleton rows={4} />}
        {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
        {q.data && list.length === 0 && (
          <EmptyState icon="💭" title="여기에 해당하는 장소가 없어요"
            body="네이버 지도나 카카오맵에서 공유 링크를 복사해 추가해 보세요."
            action={<Link to="/places/new" className="btn btn-primary">장소 추가</Link>} />
        )}
        {list.map((p) => <PlaceCard key={p.id} p={p} memberIdx={memberIdx} onClick={() => setSel(p.id)} />)}
      </div>
      <Sheet open={!!selected} onClose={() => setSel(null)} title={selected && <PlaceTitle place={selected} />}>
        {selected && <PlaceDetail key={selected.id} place={selected} onDeleted={() => setSel(null)} />}
      </Sheet>
    </div>
  );
}

const PREF_EMOJI = { MUST: "😍", GOOD: "🙂", MAYBE: "🤔", SKIP: "🙅" } as const;

function PlaceCard({ p, onClick, memberIdx }: { p: Place; onClick: () => void; memberIdx: Record<string, number> }) {
  const love = useTripMutation(() => api.post(`/api/places/${p.id}/votes`, { preference: p.my_vote === "MUST" ? null : "MUST" }),
    () => toast(p.my_vote === "MUST" ? "선택을 취소했어요" : `'${p.name}' 꼭 가고 싶어 😍`));
  return (
    <div className={`card overflow-hidden flex ${p.excluded ? "opacity-60" : ""}`}>
      <span className="w-1.5 shrink-0" style={{ background: CITY_COLOR[p.city] }} aria-hidden />
      <button onClick={onClick} className="flex-1 min-w-0 text-left p-3.5 flex gap-3">
        <span className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: CITY_COLOR[p.city] + "1f" }}>{CATEGORY_ICON[p.category] ?? "📍"}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="font-bold truncate">{p.name}</span>
            {p.both_want && <span className="chip bg-coral text-white">💕 둘 다</span>}
          </span>
          <span className="text-xs text-muted block mt-0.5">
            {p.city_label}{p.planned_day ? ` · DAY ${p.planned_day}` : " · 미배정"}{!p.has_location ? " · 위치 미정" : ""} · {p.created_by ?? "?"}
          </span>
          <span className="flex gap-1 mt-1.5 flex-wrap">
            {p.votes.filter((v) => v.preference || v.is_me).slice(0, 4).map((v) => (
              <span key={v.member_id} className="flex items-center gap-1 text-xs rounded-full pl-0.5 pr-2 py-0.5 bg-ivory border border-line">
                <Avatar name={v.nickname} index={memberIdx[v.member_id] ?? 0} size={18} />{v.preference ? `${PREF_EMOJI[v.preference]} ${PREF_SHORT[v.preference]}` : "–"}
              </span>
            ))}
          </span>
        </span>
      </button>
      <button onClick={() => love.mutate(undefined)} disabled={love.isPending} aria-pressed={p.my_vote === "MUST"} aria-label="꼭 가고 싶어"
        className={`w-14 shrink-0 flex flex-col items-center justify-center gap-0.5 border-l border-line text-[11px] font-semibold ${p.my_vote === "MUST" ? "text-coral" : "text-muted"}`}>
        <span className={`text-xl ${p.my_vote === "MUST" ? "pop" : "grayscale opacity-60"}`}>😍</span>{p.priority_score}점
      </button>
    </div>
  );
}
