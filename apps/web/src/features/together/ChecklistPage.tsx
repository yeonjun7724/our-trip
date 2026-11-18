import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useTripId, useTripMutation } from "@/services/queries";
import { EmptyState, ErrorState, Header, ListSkeleton, Segmented } from "@/components/ui";
import Icon from "@/components/Icon";
import { toast } from "@/components/Toast";

interface Item { id: string; text: string; group: "PACK" | "TODO"; done: boolean; done_by: string | null; created_by: string | null }

const PRESETS: Record<"PACK" | "TODO", string[]> = {
  PACK: ["신분증", "휴대폰 충전기", "보조배터리", "편한 운동화", "접이식 우산", "상비약", "세면도구", "여벌 옷", "선크림"],
  TODO: ["내일로 패스 구매", "열차 좌석 지정 예매", "숙소 예약 확인", "부산·경주·포항 날씨 확인", "교통카드 충전", "맛집 웨이팅 확인"],
};

export function useChecklist(tripId?: string) {
  return useQuery({ queryKey: ["checklist", tripId], queryFn: () => api.get<Item[]>(`/api/trips/${tripId}/checklist`),
    enabled: !!tripId, refetchInterval: 15_000 });
}

export default function ChecklistPage() {
  const tripId = useTripId();
  const q = useChecklist(tripId);
  const [group, setGroup] = useState<"PACK" | "TODO">("PACK");
  const [text, setText] = useState("");
  const add = useTripMutation((items: { text: string; group: string }[]) => api.post<{ added: number }>(`/api/trips/${tripId}/checklist`, { items }),
    (r) => { if (r.added) toast(`${r.added}개 추가했어요`); setText(""); });
  const toggle = useTripMutation((i: Item) => api.patch(`/api/checklist/${i.id}`, { done: !i.done }));
  const del = useTripMutation((id: string) => api.del(`/api/checklist/${id}`));
  const items = (q.data ?? []).filter((i) => i.group === group);
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  return (
    <div className="page space-y-4">
      <Header title="체크리스트" sub="둘이 같이 보는 준비물 · 할 일" />
      <Segmented value={group} onChange={setGroup} options={[{ value: "PACK", label: "🎒 준비물" }, { value: "TODO", label: "✅ 할 일" }]} />
      <section className="card p-4 flex items-center gap-4">
        <div className="relative w-16 h-16 shrink-0">
          <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-sand)" strokeWidth="4" />
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-coral)" strokeWidth="4" strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 97.4} 97.4`} style={{ transition: "stroke-dasharray .4s" }} /></svg>
          <span className="absolute inset-0 flex items-center justify-center font-extrabold text-sm">{pct}%</span>
        </div>
        <div className="flex-1"><p className="font-bold">{items.length ? `${items.length}개 중 ${done}개 완료` : "아직 항목이 없어요"}</p>
          <p className="text-sm text-muted">{pct === 100 && items.length ? "준비 끝! 떠나기만 하면 돼요 🎉" : "체크하면 상대 화면에도 바로 보여요"}</p></div>
      </section>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate([{ text: text.trim(), group }]); }}>
        <input className="field flex-1 !rounded-2xl" maxLength={120} placeholder={group === "PACK" ? "챙길 것 추가" : "할 일 추가"} value={text} onChange={(e) => setText(e.target.value)} aria-label="항목 추가" />
        <button className="btn btn-primary !rounded-2xl" disabled={!text.trim() || add.isPending}><Icon name="plus" size={18} /></button>
      </form>
      {q.isLoading && <ListSkeleton rows={3} />}
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.data && items.length === 0 && (
        <EmptyState icon={group === "PACK" ? "🎒" : "📝"} title="추천 항목으로 시작해 볼까요?" body={PRESETS[group].slice(0, 4).join(" · ") + " …"}
          action={<button className="btn btn-primary" onClick={() => add.mutate(PRESETS[group].map((t) => ({ text: t, group })))}>추천 {PRESETS[group].length}개 넣기</button>} />
      )}
      {items.length > 0 && (
        <ul className="card divide-y divide-line overflow-hidden">
          {[...items].sort((a, b) => Number(a.done) - Number(b.done)).map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 min-h-14">
              <button onClick={() => toggle.mutate(i)} aria-pressed={i.done} aria-label={i.text}
                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${i.done ? "bg-ok border-ok text-white" : "border-line"}`}>
                {i.done && <Icon name="check" size={16} stroke={3} />}
              </button>
              <span className={`flex-1 py-3 ${i.done ? "line-through text-muted" : ""}`}>{i.text}
                {i.done && i.done_by && <span className="block text-[11px] text-muted no-underline">{i.done_by} 완료</span>}</span>
              <button className="tap -mr-2 flex items-center justify-center text-muted" aria-label="삭제" onClick={() => del.mutate(i.id)}><Icon name="x" size={18} /></button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && <button className="btn btn-ghost w-full" onClick={() => add.mutate(PRESETS[group].map((t) => ({ text: t, group })))}>추천 항목 더 넣기</button>}
    </div>
  );
}
