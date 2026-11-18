import { useState } from "react";
import { Link } from "react-router-dom";
import { usePlaces, useTripId } from "@/services/queries";
import { CATEGORY_ICON, CITY_LABEL, PREF_SHORT, PREF_STYLE } from "@/services/format";
import type { City, Place } from "@/services/types";
import { EmptyState, ErrorState, Header, ListSkeleton, Segmented, Sheet } from "@/components/ui";
import PlaceDetail from "@/features/places/PlaceDetail";

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
        {list.map((p) => <PlaceCard key={p.id} p={p} onClick={() => setSel(p.id)} />)}
      </div>
      <Sheet open={!!selected} onClose={() => setSel(null)} title={selected && `${CATEGORY_ICON[selected.category]} ${selected.name}`}>
        {selected && <PlaceDetail key={selected.id} place={selected} onDeleted={() => setSel(null)} />}
      </Sheet>
    </div>
  );
}

function PlaceCard({ p, onClick }: { p: Place; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`card w-full text-left p-3.5 flex gap-3 ${p.excluded ? "opacity-60" : ""}`}>
      <span className="text-2xl w-9 text-center" aria-hidden>{CATEGORY_ICON[p.category] ?? "📍"}</span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="font-bold truncate">{p.name}</span>
          {p.both_want && <span className="chip bg-coral text-white">둘 다</span>}
        </span>
        <span className="text-xs text-muted block mt-0.5">
          {p.city_label} · {p.created_by ?? "?"} 등록{p.planned_day ? ` · DAY ${p.planned_day}` : " · 미배정"}{!p.has_location ? " · 위치 미확정" : ""}
        </span>
        <span className="flex gap-1 mt-1.5 flex-wrap">
          {p.votes.map((v) => (
            <span key={v.member_id} className={`chip ${v.preference ? PREF_STYLE[v.preference] : "bg-sand text-muted"}`}>
              {v.nickname} {v.preference ? PREF_SHORT[v.preference] : "–"}
            </span>
          ))}
        </span>
      </span>
      <span className="text-right shrink-0">
        <span className="text-xs text-muted block">점수</span>
        <span className="font-extrabold text-lg">{p.priority_score}</span>
      </span>
    </button>
  );
}
