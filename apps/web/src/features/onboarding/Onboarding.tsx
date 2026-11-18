import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import MapView from "@/components/MapView";
import Icon from "@/components/Icon";
import { Avatar, ErrorState, InlineError } from "@/components/ui";

interface Info { trip_title: string; access_code_required: boolean; members: { id: string; nickname: string }[] }

/** No room creation: the map is visible immediately; pick (or type) your name once per device. */
export function IdentityGate() {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["bootstrap"], queryFn: () => api.get<Info>("/api/bootstrap") });
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const go = useMutation({
    mutationFn: (b: { member_id?: string; nickname?: string }) => api.post("/api/bootstrap", { ...b, access_code: code || null }),
    onSuccess: () => qc.resetQueries({ queryKey: ["me"] }),
  });
  const needCode = info.data?.access_code_required;
  const blocked = go.isPending || (needCode && !code);
  return (
    <div className="fixed inset-0">
      <MapView markers={[]} showLocate={false} center={[129.2, 35.6]} zoom={8.3} />
      <div className="absolute inset-0 bg-gradient-to-b from-ivory/10 via-ivory/30 to-ivory/90 pointer-events-none" />
      <div className="absolute inset-x-0 top-0 px-5 pointer-events-none" style={{ paddingTop: "calc(var(--sat) + 28px)" }}>
        <div className="max-w-[520px] mx-auto flex items-center gap-2.5">
          <img src="/icons/icon.svg" alt="" className="w-10 h-10 rounded-xl shadow-float" />
          <span className="font-bold text-[22px] tracking-tight">Our Trip</span>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-3" style={{ paddingBottom: "calc(var(--sab) + 14px)" }}>
        <div className="glass rounded-[28px] shadow-[0_-4px_40px_rgba(30,42,68,.18)] p-5 max-w-[520px] mx-auto sheet-in">
          {info.isLoading && <div className="skeleton h-32" />}
          {info.error && <ErrorState error={info.error} retry={() => info.refetch()} />}
          {info.data && (
            <>
              <p className="text-[13px] font-bold text-coral tracking-wide">{info.data.trip_title}</p>
              <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em] mt-1">
                {info.data.members.length ? "다시 왔네요! 누구세요?" : "둘이 함께 만드는\n기차여행 지도".split("\n").map((l, i) => <span key={i} className="block">{l}</span>)}
              </h1>
              {!info.data.members.length && <p className="text-[14px] text-navy-soft mt-1.5">가고 싶은 곳을 지도에 찍고, 같이 투표하고, 걷는 길과 열차까지 한 번에.</p>}
              {needCode && (
                <input className="field mt-4" placeholder="입장 코드" value={code} onChange={(e) => setCode(e.target.value)} aria-label="입장 코드" />
              )}
              {info.data.members.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mt-4 max-h-[34dvh] overflow-y-auto overscroll-contain p-0.5 -m-0.5">
                  {info.data.members.map((m, i) => (
                    <button key={m.id} disabled={blocked} onClick={() => go.mutate({ member_id: m.id })}
                      className="card !rounded-[14px] p-3 flex items-center gap-2.5 text-left disabled:opacity-50">
                      <Avatar name={m.nickname} index={i} size={38} />
                      <span className="font-bold truncate flex-1">{m.nickname}</span>
                      <Icon name="chevronR" size={18} className="text-muted" />
                    </button>
                  ))}
                </div>
              )}
              <form className="flex gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) go.mutate({ nickname: name.trim() }); }}>
                <input className="field flex-1 !min-h-12 !rounded-[14px]" maxLength={40} placeholder={info.data.members.length ? "처음이면 이름 입력" : "내 이름 (예: 연준)"}
                  value={name} onChange={(e) => setName(e.target.value)} aria-label="이름" />
                <button className="btn btn-primary shrink-0 !min-h-12 !rounded-[14px] px-5" disabled={!name.trim() || blocked}>시작</button>
              </form>
              <InlineError error={go.error} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
