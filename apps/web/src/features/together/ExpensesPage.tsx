import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useTrip, useTripId, useTripMutation } from "@/services/queries";
import { hm, md, todayKST } from "@/services/format";
import { Avatar, EmptyState, ErrorState, Header, InlineError, ListSkeleton, Segmented, Sheet } from "@/components/ui";
import Icon from "@/components/Icon";
import { toast } from "@/components/Toast";

export const EXPENSE_CATS: Record<string, { label: string; icon: string; color: string }> = {
  TRANSPORT: { label: "교통", icon: "🚆", color: "#3182F6" }, FOOD: { label: "식비", icon: "🍜", color: "#FF6B6B" },
  CAFE: { label: "카페", icon: "☕", color: "#F08A00" }, LODGING: { label: "숙소", icon: "🛏️", color: "#8E5CC8" },
  TICKET: { label: "입장료", icon: "🎟️", color: "#00B8A9" }, SHOPPING: { label: "쇼핑", icon: "🛍️", color: "#C9821A" },
  ETC: { label: "기타", icon: "•", color: "#8B95A1" },
};

type Expense = {
  id: string; title: string; amount: number; category: string; paid_by: string | null; paid_by_name: string | null;
  split_member_ids: string[]; split_names: string[]; day_number: number | null; created_at: string;
};
interface ExpensesRes {
  expenses: Expense[];
  total: number; by_category: Record<string, number>;
  members: { id: string; nickname: string; paid: number; owed: number; balance: number }[];
  transfers: { from: string; to: string; amount: number; from_name: string; to_name: string }[];
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export function useExpenses(tripId?: string) {
  return useQuery({ queryKey: ["expenses", tripId], queryFn: () => api.get<ExpensesRes>(`/api/trips/${tripId}/expenses`),
    enabled: !!tripId, refetchInterval: 15_000 });
}

/** The trip day that is "today" in KST, if the trip is under way. */
function useTodayDay() {
  const trip = useTrip(useTripId()).data;
  const today = todayKST();
  return trip?.days.find((d) => d.travel_date === today)?.day_number ?? null;
}

type SheetState = { mode: "add"; day: number | null } | { mode: "edit"; expense: Expense } | null;

function ExpenseSheet({ state, onClose }: { state: SheetState; onClose: () => void }) {
  const tripId = useTripId()!;
  const trip = useTrip(tripId).data;
  const me = trip?.members.find((m) => m.is_me);
  const editing = state?.mode === "edit" ? state.expense : null;
  const [f, setF] = useState({ title: "", amount: "", category: "FOOD", paid_by: "", split: [] as string[], day: "" });
  useEffect(() => {
    if (!state || !trip || !me) return;
    if (editing) {
      setF({ title: editing.title, amount: String(editing.amount), category: editing.category, paid_by: editing.paid_by ?? me.id,
        split: editing.split_member_ids, day: editing.day_number ? String(editing.day_number) : "" });
    } else {
      const firstTwo = trip.members.slice(0, 2).map((m) => m.id);
      setF({ title: "", amount: "", category: "FOOD", paid_by: me.id, split: firstTwo.includes(me.id) ? firstTwo : [me.id],
        day: state.mode === "add" && state.day ? String(state.day) : "" });
    }
  }, [state]); // eslint-disable-line
  const body = () => ({
    title: f.title.trim() || EXPENSE_CATS[f.category].label, amount: Number(f.amount), category: f.category,
    paid_by: f.paid_by, split_member_ids: f.split, day_number: f.day ? Number(f.day) : null,
  });
  const save = useTripMutation(() => editing ? api.put(`/api/expenses/${editing.id}`, body()) : api.post(`/api/trips/${tripId}/expenses`, body()),
    () => { toast(editing ? "수정했어요" : `${won(Number(f.amount))} 기록했어요`); onClose(); });
  const del = useTripMutation(() => api.del(`/api/expenses/${editing!.id}`), () => { toast("삭제했어요"); onClose(); });
  const amt = Number(f.amount || 0);
  return (
    <Sheet open={!!state} onClose={onClose} title={editing ? "지출 수정" : "지출 기록"} tall>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (amt > 0 && f.split.length) save.mutate(undefined); }}>
        <div className="text-center pt-2">
          <div className="inline-flex items-baseline gap-1">
            <input inputMode="numeric" autoFocus={!editing} aria-label="금액" placeholder="0" value={f.amount ? Number(f.amount).toLocaleString("ko-KR") : ""}
              onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9]/g, "").slice(0, 8) })}
              className="text-[40px] font-bold tracking-tight text-center bg-transparent outline-none w-[240px]" />
            <span className="text-2xl font-bold text-muted">원</span>
          </div>
          {f.split.length > 1 && amt > 0 && <p className="text-sm text-muted">1인당 {won(amt / f.split.length)}</p>}
          <div className="flex justify-center gap-1.5 mt-2">
            {[5000, 10000, 50000].map((v) => (
              <button type="button" key={v} className="chip bg-sand text-navy-soft !py-1.5 !px-3" onClick={() => setF({ ...f, amount: String(amt + v) })}>+{v / 10000 >= 1 ? `${v / 10000}만` : `${v / 1000}천`}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="label">언제 썼어요?</p>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
            {trip?.days.map((d) => (
              <button type="button" key={d.id} onClick={() => setF({ ...f, day: String(d.day_number) })}
                className={`shrink-0 rounded-[14px] px-3 py-2 text-left border-2 ${f.day === String(d.day_number) ? "border-coral bg-coral-soft/50" : "border-transparent bg-sand"}`}>
                <span className="block text-[13px] font-bold">DAY {d.day_number}</span>
                <span className="block text-[11px] text-muted whitespace-nowrap">{d.travel_date ? md(d.travel_date) : d.primary_city_label}</span>
              </button>
            ))}
            <button type="button" onClick={() => setF({ ...f, day: "" })}
              className={`shrink-0 rounded-[14px] px-3 py-2 text-[13px] font-semibold border-2 ${f.day === "" ? "border-coral bg-coral-soft/50" : "border-transparent bg-sand text-muted"}`}>날짜 미정</button>
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
        <InlineError error={save.error ?? del.error} />
        <button className="btn btn-primary w-full !min-h-14 text-[17px]" disabled={amt <= 0 || !f.split.length || save.isPending}>
          {amt > 0 ? `${won(amt)} ${editing ? "수정" : "저장"}` : "금액을 입력하세요"}</button>
        {editing && (
          <button type="button" className="btn btn-outline w-full !text-bad" disabled={del.isPending}
            onClick={() => confirm(`'${editing.title}' 삭제할까요?`) && del.mutate(undefined)}><Icon name="trash" size={18} />삭제</button>
        )}
      </form>
    </Sheet>
  );
}

function CatBar({ items, total }: { items: Expense[]; total: number }) {
  const by: Record<string, number> = {};
  for (const e of items) by[e.category] = (by[e.category] ?? 0) + e.amount;
  const cats = Object.entries(by).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="flex h-2 rounded-full overflow-hidden bg-sand gap-[2px]">
        {cats.map(([k, v]) => <span key={k} style={{ width: `${(v / total) * 100}%`, background: EXPENSE_CATS[k]?.color }} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[13px] text-navy-soft">
        {cats.map(([k, v]) => <span key={k}>{EXPENSE_CATS[k]?.icon} {EXPENSE_CATS[k]?.label} <span className="num">{won(v)}</span></span>)}
      </div>
    </>
  );
}

function Row({ e, onClick }: { e: Expense; onClick: () => void }) {
  return (
    <li>
      <button className="w-full text-left flex items-center gap-3 px-4 py-3 active:bg-[#F9FAFB]" onClick={onClick}>
        <span className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: (EXPENSE_CATS[e.category]?.color ?? "#999") + "1f" }}>{EXPENSE_CATS[e.category]?.icon}</span>
        <span className="flex-1 min-w-0">
          <b className="block truncate font-semibold">{e.title}</b>
          <span className="text-[13px] text-muted">{hm(e.created_at)} · {e.paid_by_name} 결제{e.split_names.length > 1 ? ` · ${e.split_names.length}명 나눔` : ""}</span>
        </span>
        <span className="font-bold num">{won(e.amount)}</span>
      </button>
    </li>
  );
}

function DailyView({ d, onAdd, onEdit }: { d: ExpensesRes; onAdd: (day: number | null) => void; onEdit: (e: Expense) => void }) {
  const trip = useTrip(useTripId()).data;
  const todayDay = useTodayDay();
  const myName = trip?.members.find((m) => m.is_me)?.nickname;
  const groups = useMemo(() => {
    const days = (trip?.days ?? []).map((day) => ({ key: String(day.day_number), day, items: d.expenses.filter((e) => e.day_number === day.day_number) }));
    const none = d.expenses.filter((e) => !e.day_number || !trip?.days.some((x) => x.day_number === e.day_number));
    for (const g of [...days.map((x) => x.items), none]) g.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { days, none };
  }, [d, trip]);
  const max = Math.max(1, ...groups.days.map((g) => g.items.reduce((s, e) => s + e.amount, 0)));
  const spentDays = groups.days.filter((g) => g.items.length).length;
  const dated = groups.days.reduce((s, g) => s + g.items.reduce((a, e) => a + e.amount, 0), 0);
  const myShare = (items: Expense[]) => items.reduce((s, e) => s + (myName && e.split_names.includes(myName) ? e.amount / e.split_names.length : 0), 0);

  return (
    <div className="space-y-3">
      {/* day-by-day bars */}
      <section className="card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px] font-bold tracking-[-0.02em]">날짜별 지출</h2>
          {spentDays > 0 && <span className="text-[13px] text-muted">하루 평균 <b className="text-navy num">{won(dated / spentDays)}</b></span>}
        </div>
        {dated === 0 ? (
          <p className="text-[14px] text-muted mt-3">아직 날짜를 정한 지출이 없어요. 지출을 눌러 DAY를 정하면 날짜별로 정리돼요.</p>
        ) : (
        <div className="flex items-end gap-2 h-[120px] mt-4">
          {groups.days.map(({ key, day, items }) => {
            const sum = items.reduce((s, e) => s + e.amount, 0);
            return (
              <a key={key} href={`#day-${key}`} className="flex-1 h-full flex flex-col items-center justify-end gap-1.5 min-w-0">
                <span className="text-[11px] font-semibold text-navy-soft num truncate max-w-full">{sum ? (sum >= 10000 ? `${Math.round(sum / 1000) / 10}만` : sum.toLocaleString()) : ""}</span>
                <span className={`w-full max-w-[44px] rounded-[8px] ${day.day_number === todayDay ? "bg-coral" : sum ? "bg-[#90C2FF]" : "bg-sand"}`}
                  style={{ height: `${Math.max(6, (sum / max) * 80)}px` }} />
                <span className={`text-[12px] font-bold ${day.day_number === todayDay ? "text-coral" : "text-muted"}`}>DAY {day.day_number}</span>
              </a>
            );
          })}
        </div>
        )}
      </section>

      {groups.days.map(({ key, day, items }) => {
        const sum = items.reduce((s, e) => s + e.amount, 0);
        const mine = myShare(items);
        return (
          <section key={key} id={`day-${key}`} className="card overflow-hidden scroll-mt-20">
            <div className="px-5 pt-4 pb-3">
              <div className="flex items-center gap-2">
                <span className={`chip ${day.day_number === todayDay ? "bg-coral text-white" : "bg-coral-soft text-coral-ink"}`}>DAY {day.day_number}{day.day_number === todayDay ? " · 오늘" : ""}</span>
                <span className="text-[14px] text-navy-soft font-medium truncate">{day.travel_date ? md(day.travel_date) : "날짜 미정"} · {day.primary_city_label}</span>
              </div>
              <div className="flex items-end justify-between mt-2">
                <p className="text-[24px] font-bold tracking-[-0.03em] num">{won(sum)}</p>
                {sum > 0 && myName && <p className="text-[13px] text-muted mb-1">내 몫 <b className="text-navy num">{won(mine)}</b></p>}
              </div>
              {sum > 0 && <div className="mt-3"><CatBar items={items} total={sum} /></div>}
            </div>
            {items.length > 0 && <ul className="divide-y divide-line border-t border-line">{items.map((e) => <Row key={e.id} e={e} onClick={() => onEdit(e)} />)}</ul>}
            <button className="w-full border-t border-line min-h-12 text-[14px] font-semibold text-coral flex items-center justify-center gap-1 active:bg-[#F9FAFB]"
              onClick={() => onAdd(day.day_number)}><Icon name="plus" size={16} stroke={2.4} />DAY {day.day_number} 지출 기록</button>
          </section>
        );
      })}

      {groups.none.length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-5 pt-4 pb-3">
            <p className="text-[15px] font-bold">날짜 미정</p>
            <p className="text-[13px] text-muted mt-0.5">눌러서 날짜를 정하면 그날 지출에 들어가요.</p>
            <p className="text-[20px] font-bold num mt-1.5">{won(groups.none.reduce((s, e) => s + e.amount, 0))}</p>
          </div>
          <ul className="divide-y divide-line border-t border-line">{groups.none.map((e) => <Row key={e.id} e={e} onClick={() => onEdit(e)} />)}</ul>
        </section>
      )}
    </div>
  );
}

function SettleView({ d }: { d: ExpensesRes }) {
  const trip = useTrip(useTripId()).data;
  const idx = useMemo(() => Object.fromEntries((trip?.members ?? []).map((m, i) => [m.id, i])), [trip]);
  return (
    <section className="card p-5">
      <h2 className="text-[17px] font-bold tracking-[-0.02em] mb-3">정산</h2>
      <div className="space-y-2">
        {d.members.map((m) => (
          <div key={m.id} className="flex items-center gap-3">
            <Avatar name={m.nickname} index={idx[m.id] ?? 0} size={32} />
            <span className="flex-1 min-w-0"><b className="block truncate">{m.nickname}</b><span className="text-xs text-muted">낸 돈 {won(m.paid)} · 몫 {won(m.owed)}</span></span>
            <span className={`font-bold num ${m.balance > 0 ? "text-ok" : m.balance < 0 ? "text-bad" : "text-muted"}`}>{m.balance > 0 ? "+" : ""}{won(m.balance)}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {d.transfers.length === 0 ? <p className="text-sm text-muted">정산할 금액이 없어요 👍</p> : d.transfers.map((t, i) => (
          <div key={i} className="rounded-2xl bg-coral-soft/60 px-4 py-3 flex items-center gap-2 font-semibold">
            <span>{t.from_name}</span><Icon name="chevronR" size={16} className="text-coral" /><span>{t.to_name}</span>
            <span className="ml-auto text-coral text-lg num">{won(t.amount)}</span>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-muted mt-4">지출마다 고른 사람끼리 똑같이 나눠 계산해요.</p>
    </section>
  );
}

export default function ExpensesPage() {
  const tripId = useTripId();
  const q = useExpenses(tripId);
  const todayDay = useTodayDay();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [tab, setTab] = useState<"daily" | "settle">("daily");
  const d = q.data;
  const cats = Object.entries(d?.by_category ?? {}).sort((a, b) => b[1] - a[1]);
  const add = (day: number | null = todayDay) => setSheet({ mode: "add", day });
  return (
    <div className="page space-y-4">
      <Header eyebrow="함께 쓴 돈" title="여행 가계부" help="expenses" sub="매일 쓴 돈을 기록하고 마지막에 깔끔하게 정산해요"
        right={<button className="btn btn-primary" onClick={() => add()}><Icon name="plus" size={18} />기록</button>} />
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
          {d.expenses.length === 0 ? (
            <EmptyState icon="💸" title="아직 기록이 없어요" body="KTX, 밀면, 카페… 쓴 돈을 그날그날 적어 두면 하루 정리와 정산이 자동으로 돼요."
              action={<button className="btn btn-primary" onClick={() => add()}>첫 지출 기록</button>} />
          ) : (
            <>
              <Segmented value={tab} onChange={setTab} options={[{ value: "daily", label: "날짜별" }, { value: "settle", label: "정산" }]} />
              {tab === "daily" ? <DailyView d={d} onAdd={add} onEdit={(e) => setSheet({ mode: "edit", expense: e })} /> : <SettleView d={d} />}
            </>
          )}
        </>
      )}
      <ExpenseSheet state={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}
