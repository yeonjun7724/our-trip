import { useState } from "react";
import { Link } from "react-router-dom";
import { usePlaces, useTrip, useTripId, useTripMutation } from "@/services/queries";
import { api } from "@/services/api";
import { toast } from "@/components/Toast";
import { CATEGORY_ICON, CITY_COLOR, CITY_LABEL, PREF_SHORT } from "@/services/format";
import type { City, Place } from "@/services/types";
import Icon from "@/components/Icon";
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
      <Header eyebrow="함께 고르는 곳" title="위시리스트" sub={`${q.data?.length ?? 0}곳 · 둘 다 원하는 곳 ${q.data?.filter((p) => p.both_want).length ?? 0}곳`}
        right={<Link to="/places/new" className="btn btn-primary !min-h-11 !px-4"><Icon name="plus" size={18} stroke={2.6} />추가</Link>} />
      <Segmented value={tab} onChange={setTab} options={[
        { value: "all", label: "전체" }, { value: "both", label: "둘 다 💕" }, { value: "mine", label: "내가 추가" },
        { value: "partner", label: "상대가 추가" }, { value: "unassigned", label: "일정 미배정" }, { value: "assigned", label: "일정 확정" }]} />
      <div className="flex gap-2 mt-2 items-center">
        <Segmented size="sm" value={city} onChange={setCity} options={[
          { value: "all", label: "모든 도시" }, ...(["busan", "gyeongju", "pohang"] as City[]).map((c) => ({ value: c, label: CITY_LABEL[c] }))]} />
        <select className="field !w-[104px] shrink-0 !min-h-9 !py-1 !pl-3 !rounded-full text-sm ml-auto !text-[14px] font-semibold" value={sort} onChange={(e) => setSort(e.target.value as never)} aria-label="정렬">
          <option value="score">추천순</option><option value="recent">최근 수정순</option>
        </select>
      </div>
      <div className="mt-5">
        {q.isLoading && <ListSkeleton rows={4} />}
        {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
        {q.data && list.length === 0 && (
          <EmptyState icon="💭" title="여기에 해당하는 장소가 없어요"
            body="네이버 지도나 카카오맵에서 공유 링크를 복사해 추가해 보세요."
            action={<Link to="/places/new" className="btn btn-primary">장소 추가</Link>} />
        )}
        {(["busan", "gyeongju", "pohang", "other"] as City[]).map((c) => {
          const group = list.filter((p) => p.city === c);
          if (!group.length) return null;
          return (
            <section key={c} className="mb-6">
              <h2 className="flex items-center gap-2 px-1 mb-2.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: CITY_COLOR[c], boxShadow: `0 0 0 4px ${CITY_COLOR[c]}26` }} />
                <span className="text-[17px] font-bold tracking-[-0.025em]">{CITY_LABEL[c]}</span>
                <span className="text-[14px] font-semibold text-muted num">{group.length}</span>
              </h2>
              <div className="space-y-2">
                {group.map((p) => <PlaceCard key={p.id} p={p} memberIdx={memberIdx} onClick={() => setSel(p.id)} />)}
              </div>
            </section>
          );
        })}
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
      <button onClick={onClick} className="flex-1 min-w-0 text-left pl-4 pr-2 py-3.5 flex items-center gap-3.5 active:bg-[#FBFAF8] transition-colors">
        <span className="w-[52px] h-[52px] rounded-[16px] flex items-center justify-center text-[22px] shrink-0" style={{ background: `linear-gradient(145deg, ${CITY_COLOR[p.city]}26, ${CITY_COLOR[p.city]}0d)` }}>{CATEGORY_ICON[p.category] ?? "📍"}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="font-semibold text-[16px] truncate">{p.name}</span>
            {p.both_want && <span className="chip bg-sunset-soft text-sunset">💕 둘 다</span>}
          </span>
          <span className="text-[13px] text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
            {p.planned_day ? <span className="chip !py-0 bg-coral-soft text-coral-ink">DAY {p.planned_day}</span> : <span>미배정</span>}
            {!p.has_location && <span>· 위치 미정</span>}<span>· {p.created_by ?? "?"}</span>
          </span>
          <span className="flex gap-1 mt-1.5 flex-wrap">
            {p.votes.filter((v) => v.preference || v.is_me).slice(0, 4).map((v) => (
              <span key={v.member_id} className="flex items-center gap-1 text-xs rounded-full pl-0.5 pr-2 py-0.5 bg-sand">
                <Avatar name={v.nickname} index={memberIdx[v.member_id] ?? 0} size={18} />{v.preference ? `${PREF_EMOJI[v.preference]} ${PREF_SHORT[v.preference]}` : "–"}
              </span>
            ))}
          </span>
        </span>
      </button>
      <button onClick={() => love.mutate(undefined)} disabled={love.isPending} aria-pressed={p.my_vote === "MUST"} aria-label="꼭 가고 싶어"
        className={`w-16 shrink-0 flex flex-col items-center justify-center gap-1 text-[11px] active:scale-90 transition-transform font-bold num ${p.my_vote === "MUST" ? "text-sunset" : "text-muted"}`}>
        <span className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${p.my_vote === "MUST" ? "bg-sunset-soft pop" : "bg-sand"}`}>
          <Icon name="heart" size={20} stroke={2.2} fill={p.my_vote === "MUST" ? "currentColor" : "none"} />
        </span>{p.priority_score}점
      </button>
    </div>
  );
}
