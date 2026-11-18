import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import MapView from "@/components/MapView";
import { ErrorState, InlineError } from "@/components/ui";

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
  return (
    <div className="fixed inset-0">
      <MapView markers={[]} showLocate={false} />
      <div className="absolute inset-x-0 bottom-0 p-3" style={{ paddingBottom: "calc(var(--sab) + 12px)" }}>
        <div className="card shadow-xl p-4 max-w-[520px] mx-auto">
          {info.isLoading && <div className="skeleton h-24" />}
          {info.error && <ErrorState error={info.error} retry={() => info.refetch()} />}
          {info.data && (
            <>
              <p className="text-sm text-muted">{info.data.trip_title}</p>
              <p className="font-extrabold text-lg mt-0.5">누구세요?</p>
              {needCode && (
                <input className="field mt-3" placeholder="입장 코드" value={code} onChange={(e) => setCode(e.target.value)} aria-label="입장 코드" />
              )}
              {info.data.members.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {info.data.members.map((m) => (
                    <button key={m.id} className="btn btn-primary" disabled={go.isPending || (needCode && !code)}
                      onClick={() => go.mutate({ member_id: m.id })}>{m.nickname}</button>
                  ))}
                </div>
              )}
              <form className="flex gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) go.mutate({ nickname: name.trim() }); }}>
                <input className="field flex-1" maxLength={40} placeholder={info.data.members.length ? "처음이면 이름 입력" : "이름 (예: 연준)"}
                  value={name} onChange={(e) => setName(e.target.value)} aria-label="이름" />
                <button className="btn btn-ghost shrink-0" disabled={!name.trim() || go.isPending || (needCode && !code)}>시작</button>
              </form>
              <InlineError error={go.error} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
