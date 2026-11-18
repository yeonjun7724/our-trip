import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/services/api";
import { useTrip, useTripId, useTripMutation } from "@/services/queries";
import type { Trip } from "@/services/types";
import { ErrorState, Header, InlineError, ListSkeleton, Notice } from "@/components/ui";

interface ProviderStatus { provider: string; role: string; state: string; last_success_at: string | null; last_error_code: string | null; usage_today: Record<string, number> }

const STATE_LABEL: Record<string, string> = {
  NOT_CONFIGURED: "키 미설정", CONFIGURED_UNVERIFIED: "키 설정됨 · 아직 응답 확인 전", VERIFIED: "정상 응답 확인됨",
  AUTH_FAILED: "인증 실패", COOLDOWN: "호출 한도로 잠시 중지", DISABLED: "꺼짐",
};

function TripForm({ trip }: { trip: Trip }) {
  const [f, setF] = useState({
    title: trip.title, start_date: trip.start_date ?? "", end_date: trip.end_date ?? "",
    departure_station_name: trip.departure_station_name ?? "", return_station_name: trip.return_station_name ?? "",
    rail_pass_type: trip.rail_pass_type, station_buffer_minutes: trip.station_buffer_minutes, walking_speed_kmh: trip.walking_speed_kmh,
  });
  const save = useTripMutation(() => api.patch(`/api/trips/${trip.id}`, {
    version: trip.version, ...f, start_date: f.start_date || null, end_date: f.end_date || null,
    clear_dates: !f.start_date && !f.end_date && !!(trip.start_date || trip.end_date),
  }));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === "number" || e.target.type === "range" ? Number(e.target.value) : e.target.value });
  return (
    <form className="card p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
      <h2 className="text-[18px] font-bold tracking-[-0.02em]">여행 정보</h2>
      <div><label className="label" htmlFor="st">여행 이름</label><input id="st" className="field" value={f.title} onChange={set("title")} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="ssd">시작일</label><input id="ssd" type="date" className="field" value={f.start_date} onChange={set("start_date")} /></div>
        <div><label className="label" htmlFor="sed">종료일</label><input id="sed" type="date" className="field" value={f.end_date} onChange={set("end_date")} /></div>
        <div><label className="label" htmlFor="sds">출발역</label><input id="sds" className="field" value={f.departure_station_name} onChange={set("departure_station_name")} /></div>
        <div><label className="label" htmlFor="srs">귀가역</label><input id="srs" className="field" value={f.return_station_name} onChange={set("return_station_name")} /></div>
      </div>
      <div><label className="label" htmlFor="sps">내일로 패스</label>
        <select id="sps" className="field" value={f.rail_pass_type} onChange={set("rail_pass_type")}>
          <option value="UNDECIDED">미정</option><option value="SELECT_3">선택 3일권</option><option value="CONTINUOUS_7">연속 7일권</option>
        </select></div>
      <div><label className="label" htmlFor="sbf">열차 출발 전 여유시간: {f.station_buffer_minutes}분</label>
        <input id="sbf" type="range" min={0} max={60} step={5} className="w-full accent-coral" value={f.station_buffer_minutes} onChange={set("station_buffer_minutes")} />
        <p className="text-xs text-muted">공식 탑승 규정이 아니라 우리가 정한 계획 버퍼예요.</p></div>
      <div><label className="label" htmlFor="sws">보행 속도: {f.walking_speed_kmh} km/h</label>
        <input id="sws" type="range" min={2.5} max={6} step={0.5} className="w-full accent-coral" value={f.walking_speed_kmh} onChange={set("walking_speed_kmh")} /></div>
      {save.error instanceof ApiError && save.error.status === 409 ? <Notice tone="warn">다른 사람이 먼저 수정했어요. 새로고침된 내용을 확인해 주세요.</Notice> : <InlineError error={save.error} />}
      {save.isSuccess && <p className="text-sm text-ok">저장했어요.</p>}
      <button className="btn btn-primary w-full" disabled={save.isPending}>저장</button>
    </form>
  );
}

function ShareApp({ trip }: { trip: Trip }) {
  const url = window.location.origin;
  const [done, setDone] = useState(false);
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: trip.title, text: "우리 여행 지도", url }); return; } catch { /* cancelled */ } }
    await navigator.clipboard?.writeText(url); setDone(true);
  };
  return (
    <div className="card p-5 space-y-2" id="invite">
      <h2 className="text-[18px] font-bold tracking-[-0.02em]">같이 쓰기</h2>
      <p className="text-sm text-navy-soft">참여자: {trip.members.map((m) => `${m.nickname}${m.is_me ? "(나)" : ""}`).join(", ")}</p>
      <p className="text-sm">이 주소를 보내면 열자마자 지도가 뜨고, 이름만 고르면 함께 편집할 수 있어요.</p>
      <p className="text-xs num font-semibold bg-sand rounded-lg p-2 break-all select-all" data-testid="app-url">{url}</p>
      <button className="btn btn-outline w-full" onClick={share}>{done ? "복사했어요" : "주소 공유 / 복사"}</button>
    </div>
  );
}

function Providers() {
  const q = useQuery({ queryKey: ["providers"], queryFn: () => api.get<{ providers: ProviderStatus[]; walking: { zones: { zone_id: string; label: string; built_at: string }[]; license: string }; notes: string[] }>("/api/providers/status") });
  if (q.isLoading) return <ListSkeleton rows={1} />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <div className="card p-5 space-y-2">
      <h2 className="text-[18px] font-bold tracking-[-0.02em]">데이터 연결 상태</h2>
      {q.data!.providers.map((p) => (
        <div key={p.provider} className="flex items-start gap-2 text-sm">
          <span className={`w-2 h-2 rounded-full mt-1.5 ${p.state === "VERIFIED" ? "bg-ok" : p.state === "NOT_CONFIGURED" ? "bg-line" : p.state === "AUTH_FAILED" ? "bg-bad" : "bg-warn"}`} />
          <span className="flex-1"><b>{p.provider}</b> · {p.role}<br /><span className="text-xs text-muted">{STATE_LABEL[p.state] ?? p.state}{p.last_error_code ? ` · 최근 오류 ${p.last_error_code}` : ""}</span></span>
        </div>
      ))}
      <div className="text-sm pt-1"><b>OSMnx 보행 네트워크</b> · {q.data!.walking.zones.length}개 권역<br />
        <span className="text-xs text-muted">{q.data!.walking.license}</span></div>
      {q.data!.notes.map((n) => <p key={n} className="text-[11px] text-muted">{n}</p>)}
    </div>
  );
}

export default function SettingsPage() {
  const tripId = useTripId();
  const trip = useTrip(tripId);
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  useEffect(() => { if (params.get("invite")) setTimeout(() => document.getElementById("invite")?.scrollIntoView({ behavior: "smooth" }), 300); }, [params, trip.data]);
  const logout = useMutation({ mutationFn: () => api.post("/api/logout"), onSuccess: async () => { qc.clear(); nav("/welcome", { replace: true }); } });
  if (trip.isLoading) return <div className="page"><ListSkeleton rows={3} /></div>;
  if (trip.error) return <div className="page"><ErrorState error={trip.error} /></div>;
  return (
    <div className="page space-y-4">
      <Header eyebrow="Our Trip" title="여행 설정" help="settings" right={<button className="btn btn-ghost" onClick={() => nav(-1)}>닫기</button>} />
      <ShareApp trip={trip.data!} />
      <TripForm key={trip.data!.version} trip={trip.data!} />
      <Providers />
      <p className="text-xs text-muted">여행방 ID: <span className="num font-semibold select-all">{trip.data!.id}</span></p>
      <button className="btn btn-outline w-full" onClick={() => logout.mutate()}>이 기기에서 나가기</button>
      <p className="text-[11px] text-muted">지도 © OpenStreetMap contributors</p>
    </div>
  );
}
