import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { ago } from "@/services/format";
import { useTripMutation } from "@/services/queries";
import { Avatar } from "@/components/ui";
import Icon from "@/components/Icon";

interface C { id: string; text: string; member_id: string | null; nickname: string; is_me: boolean; created_at: string }

/** Chat-style thread per place, so the two of you can talk about it right where it is. */
export default function Comments({ placeId, memberIdx }: { placeId: string; memberIdx: Record<string, number> }) {
  const q = useQuery({ queryKey: ["comments", placeId], queryFn: () => api.get<C[]>(`/api/places/${placeId}/comments`), refetchInterval: 10_000 });
  const [text, setText] = useState("");
  const send = useTripMutation(() => api.post(`/api/places/${placeId}/comments`, { text: text.trim() }), () => setText(""));
  const del = useTripMutation((id: string) => api.del(`/api/comments/${id}`));
  return (
    <section>
      <h3 className="text-[17px] font-bold tracking-[-0.02em] mb-3 flex items-center gap-1.5">💬 우리 대화 {q.data?.length ? <span className="text-muted font-semibold text-sm">{q.data.length}</span> : null}</h3>
      <div className="space-y-2">
        {q.data?.length === 0 && <p className="text-sm text-muted">"여기 해 질 때 가자!" 같은 이야기를 남겨 보세요.</p>}
        {q.data?.map((c) => (
          <div key={c.id} className={`flex gap-2 items-end ${c.is_me ? "flex-row-reverse" : ""}`}>
            {!c.is_me && <Avatar name={c.nickname} index={c.member_id ? memberIdx[c.member_id] ?? 0 : 0} size={26} />}
            <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[15px] ${c.is_me ? "bg-coral text-white rounded-br-md" : "bg-paper shadow-[0_0_0_1px_var(--color-line)_inset] rounded-bl-md"}`}>
              {c.text}
            </div>
            <span className="text-[10px] text-muted shrink-0 pb-1">{ago(c.created_at)}
              {c.is_me && <button className="ml-1 underline" onClick={() => del.mutate(c.id)} aria-label="댓글 삭제">삭제</button>}</span>
          </div>
        ))}
      </div>
      <form className="flex gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(undefined); }}>
        <input className="field flex-1 !rounded-full" maxLength={500} placeholder="메시지 남기기" value={text} onChange={(e) => setText(e.target.value)} aria-label="댓글" />
        <button className="w-11 h-11 rounded-full bg-coral text-white flex items-center justify-center shrink-0 disabled:opacity-40" disabled={!text.trim() || send.isPending} aria-label="보내기">
          <Icon name="up" size={20} stroke={2.6} />
        </button>
      </form>
    </section>
  );
}
