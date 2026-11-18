import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useTrip, useTripId, useTripMutation } from "@/services/queries";
import { Avatar, EmptyState, ErrorState, Header, InlineError, ListSkeleton, Sheet } from "@/components/ui";
import Icon from "@/components/Icon";
import { toast } from "@/components/Toast";

export const EXPENSE_CATS: Record<string, { label: string; icon: string; color: string }> = {
  TRANSPORT: { label: "교통", icon: "🚆", color: "#3182F6" }, FOOD: { label: "식비", icon: "🍜", color: "#FF6B6B" },
  CAFE: { label: "카페", icon: "☕", color: "#F08A00" }, LODGING: { label: "숙소", icon: "🛏️", color: "#8E5CC8" },
  TICKET: { label: "입장료", icon: "🎟️", color: "#00B8A9" }, SHOPPING: { label: "쇼핑", icon: "🛍️", color: "#C9821A" },
  ETC: { label: "기타", icon: "•", color: "#8B95A1" },
};

interface ExpensesRes {
  expenses: { id: string; title: string; amount: number; category: string; paid_by: string | null; paid_by_name: string | null;
    split_names: string[]; day_number: number | null; created_at: string }[];
  total: number; by_category: Record<string, number>;
  members: { id: string; nickname: string; paid: number; owed: number; balance: number }[];
  transfers: { from: string; to: string; amount: number; from_name: string; to_name: string }[];
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export function useExpenses(tripId?: string) {
  return useQuery({ queryKey: ["expenses", tripId], queryFn: () => api.get<ExpensesRes>(`/api/trips/${tripId}/expenses`),
    enabled: !!tripId, refetchInterval: 15_000 });
}

function AddExpense({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tripId = useTripId()!;
  const trip = useTrip(tripId).data;
  const me = trip?.members.find((m) => m.is_me);
  const [f, setF] = useState({ title: "", amount: "", category: "FOOD", paid_by: "", split: [] as string[], day: "" });
  useEffect(() => {
    if (open && trip && me) setF({ title: "", amount: "", category: "FOOD", paid_by: me.id, split: trip.members.slice(0, 2).map((m) => m.id).includes(me.id) ? trip.members.slice(0, 2).map((m) => m.id) : [me.id], day: "" });
  }, [open]); // eslint-disable-line
  const save = useTripMutation(() => api.post(`/api/trips/${tripId}/expenses`, {
    title: f.title.trim() || EXPENSE_CATS[f.category].label, amount: Number(f.amount), category: f.category,
    paid_by: f.paid_by, split_member_ids: f.split, day_number: f.day ? Number(f.day) : null,
  }), () => { toast(`${won(Number(f.amount))} 기록했어요`); onClose(); });
  const amt = Number(f.amount || 0);
  return (
    <Sheet open={open} onClose={onClose} title="지출 기록" tall>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (amt > 0 && f.split.length) save.mutate(undefined); }}>
        <div className="text-center pt-2">
          <div className="inline-flex items-baseline gap-1">
            <input inputMode="numeric" autoFocus aria-label="금액" placeholder="0" value={f.amount ? Number(f.amount).toLocaleString("ko-KR") : ""}
              onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9]/g, "").slice(0, 8) })}
              className="text-[40px] font-bold tracking-tight text-center bg-transparent outline-none w-[240px]" />
            <span className="text-2xl font-bold text-muted">원</span>
          </div>
          {f.split.length > 1 && amt > 0 && <p className="text-sm text-muted">1인당 {won(Math.round(amt / f.split.length))}</p>}
          <div className="flex justify-center gap-1.5 mt-2">
            {[5000, 10000, 50000].map((v) => (
              <button type="button" key={v} className="chip bg-sand text-navy-soft !py-1.5 !px-3" onClick={() => setF({ ...f, amount: String(amt + v) })}>+{v / 10000 >= 1 ? `${v / 10000}만` : `${v / 1000}천`}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(EXPENSE_CATS).map(([k, c]) => (
            <button type="button" key={k} onClick={() => setF({ ...f, category: k })}
              className={`rounded-2xl py-2.5 flex flex-col items-center gap-1 text-xs font-semibold border-2 transition-colors ${f.category === k ? "border-coral bg-coral-soft/50" : "border-transparent bg-paper shadow-[0_0_0_1px_var(--color-line)_inset]"}`}>
              <span className="text-xl">{c.icon}</span>{c.label}
            </button>
          ))}
        </div>
        <input className="field" maxLength={80} placeholder="내용 (예: 해운대 밀면)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="내용" />
        <div>
          <p className="label">누가 냈어요?</p>
          <div className="flex flex-wrap gap-2">
            {trip?.members.map((m, i) => (
              <button type="button" key={m.id} onClick={() => setF({ ...f, paid_by: m.id })}
                className={`flex items-center gap-2 rounded-full pl-1 pr-3 py-1 border-2 ${f.paid_by === m.id ? "border-coral bg-coral-soft/50" : "border-line bg-paper"}`}>
                <Avatar name={m.nickname} index={i} size={28} /><span className="text-sm font-semibold">{m.nickname}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="label">누구랑 나눠요?</p>
          <div className="flex flex-wrap gap-2">
            {trip?.members.map((m, i) => {
              const on = f.split.includes(m.id);
              return (
                <button type="button" key={m.id} onClick={() => setF({ ...f, split: on ? f.split.filter((x) => x !== m.id) : [...f.split, m.id] })}
                  className={`flex items-center gap-2 rounded-full pl-1 pr-3 py-1 border-2 ${on ? "border-navy bg-navy text-white" : "border-line bg-paper"}`}>
                  <Avatar name={m.nickname} index={i} size={28} /><span className="text-sm font-semibold">{m.nickname}</span>{on && <Icon name="check" size={14} />}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block"><span className="label">날짜 (선택)</span>
          <select className="field" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })}>
            <option value="">선택 안 함</option>{trip?.days.map((d) => <option key={d.id} value={d.day_number}>DAY {d.day_number} {d.primary_city_label}</option>)}
          </select></label>
        <InlineError error={save.error} />
        <button className="btn btn-primary w-full !min-h-14 text-[17px]" disabled={amt <= 0 || !f.split.length || save.isPending}>{amt > 0 ? `${won(amt)} 저장` : "금액을 입력하세요"}</button>
      </form>
    </Sheet>
  );
}

export default function ExpensesPage() {
  const tripId = useTripId();
  const q = useExpenses(tripId);
  const trip = useTrip(tripId).data;
  const [adding, setAdding] = useState(false);
  const idx = useMemo(() => Object.fromEntries((trip?.members ?? []).map((m, i) => [m.id, i])), [trip]);
  const del = useTripMutation((id: string) => api.del(`/api/expenses/${id}`), () => toast("삭제했어요"));
  const d = q.data;
  const cats = Object.entries(d?.by_category ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="page space-y-4">
      <Header eyebrow="함께 쓴 돈" title="여행 가계부" sub="같이 쓴 돈을 기록하고 마지막에 깔끔하게 정산해요"
        right={<button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />기록</button>} />
      {q.isLoading && <ListSkeleton rows={3} />}
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {d && (
        <>
          <section className="card p-6">
            <p className="text-[15px] text-navy-soft font-medium">총 지출</p>
            <p className="text-[32px] font-bold tracking-[-0.03em] leading-tight mt-0.5 num">{won(d.total)}</p>
            {d.total > 0 && (
              <>
                <div className="flex h-2.5 rounded-full overflow-hidden mt-4 bg-sand gap-[2px]">
                  {cats.map(([k, v]) => <span key={k} style={{ width: `${(v / d.total) * 100}%`, background: EXPENSE_CATS[k]?.color }} />)}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5 text-[13px] text-navy-soft">
                  {cats.map(([k, v]) => <span key={k}>{EXPENSE_CATS[k]?.icon} {EXPENSE_CATS[k]?.label} {Math.round((v / d.total) * 100)}%</span>)}
                </div>
              </>
            )}
          </section>

          {d.members.length > 0 && (
            <section className="card p-5">
              <h2 className="text-[18px] font-bold tracking-[-0.02em] mb-3">정산</h2>
              <div className="space-y-2">
                {d.members.map((m) => (
                  <div key={m.id} className="flex items-center gap-3">
                    <Avatar name={m.nickname} index={idx[m.id] ?? 0} size={32} />
                    <span className="flex-1 min-w-0"><b className="block truncate">{m.nickname}</b><span className="text-xs text-muted">낸 돈 {won(m.paid)} · 몫 {won(m.owed)}</span></span>
                    <span className={`font-bold ${m.balance > 0 ? "text-ok" : m.balance < 0 ? "text-bad" : "text-muted"}`}>{m.balance > 0 ? "+" : ""}{won(m.balance)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {d.transfers.length === 0 ? <p className="text-sm text-muted">정산할 금액이 없어요 👍</p> : d.transfers.map((t, i) => (
                  <div key={i} className="rounded-2xl bg-coral-soft/60 px-4 py-3 flex items-center gap-2 font-semibold">
                    <span>{t.from_name}</span><Icon name="chevronR" size={16} className="text-coral" /><span>{t.to_name}</span>
                    <span className="ml-auto text-coral text-lg">{won(t.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-[18px] font-bold tracking-[-0.02em] mb-2">내역 {d.expenses.length}</h2>
            {d.expenses.length === 0 ? (
              <EmptyState icon="💸" title="아직 기록이 없어요" body="KTX, 밀면, 카페… 같이 쓴 돈을 바로바로 적어 두면 마지막에 편해요."
                action={<button className="btn btn-primary" onClick={() => setAdding(true)}>첫 지출 기록</button>} />
            ) : (
              <ul className="card divide-y divide-line overflow-hidden">
                {d.expenses.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: (EXPENSE_CATS[e.category]?.color ?? "#999") + "1f" }}>{EXPENSE_CATS[e.category]?.icon}</span>
                    <span className="flex-1 min-w-0">
                      <b className="block truncate">{e.title}</b>
                      <span className="text-xs text-muted">{e.paid_by_name} 결제 · {e.split_names.length > 1 ? `${e.split_names.length}명 나눔` : "본인"}{e.day_number ? ` · DAY ${e.day_number}` : ""}</span>
                    </span>
                    <span className="font-bold">{won(e.amount)}</span>
                    <button className="tap -mr-2 flex items-center justify-center text-muted" aria-label="삭제" onClick={() => confirm(`'${e.title}' 삭제할까요?`) && del.mutate(e.id)}><Icon name="trash" size={18} /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-[11px] text-muted">지출마다 고른 사람끼리 똑같이 나눠 계산해요.</p>
        </>
      )}
      <AddExpense open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
