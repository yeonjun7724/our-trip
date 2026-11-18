import { type ReactNode, useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { createPortal } from "react-dom";
import { ApiError } from "@/services/api";
import { PROVIDER_LABEL, STATUS_LABEL, ago } from "@/services/format";
import type { DataStatus } from "@/services/types";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="불러오는 중">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-20" />)}
    </div>
  );
}

export function EmptyState({ icon = "🗺️", title, body, action }: { icon?: string; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card p-6 text-center">
      <div className="text-3xl mb-2" aria-hidden>{icon}</div>
      <p className="font-bold">{title}</p>
      {body && <p className="text-sm text-muted mt-1">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : "문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
  const offline = error instanceof ApiError && error.code === "NETWORK";
  return (
    <div className="card p-4 border-bad/30 bg-[#FFF5F3]" role="alert">
      <p className="font-semibold text-bad">{offline ? "오프라인 상태예요" : "불러오지 못했어요"}</p>
      <p className="text-sm text-navy-soft mt-1">{msg}</p>
      {retry && <button className="btn btn-outline mt-3" onClick={retry}>다시 시도</button>}
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : "요청을 처리하지 못했어요.";
  return <p className="text-sm text-bad mt-2" role="alert">{msg}</p>;
}

const STATUS_STYLE: Record<DataStatus, string> = {
  USER_ENTERED: "bg-sand text-navy-soft", VERIFIED_STATIC: "bg-[#E8F0FB] text-sea", SCHEDULED: "bg-[#E9F5EE] text-ok",
  LIVE: "bg-[#E9F5EE] text-ok", ESTIMATED: "bg-[#FFF4E0] text-warn", UNAVAILABLE: "bg-line text-muted", STALE: "bg-[#FDE8E6] text-bad",
};

/** Shows what a value is (status) and where it came from (provider/time). */
export function SourceBadge({ status, provider, at }: { status: DataStatus; provider?: string | null; at?: string | null }) {
  return (
    <span className={`chip ${STATUS_STYLE[status] ?? "bg-sand"}`} title={provider ?? ""}>
      {STATUS_LABEL[status] ?? status}
      {provider && <span className="font-normal opacity-80">· {PROVIDER_LABEL[provider] ?? provider}</span>}
      {at && <span className="font-normal opacity-80">· {ago(at)}</span>}
    </span>
  );
}

/**
 * Bottom sheet with two snap heights. Drag the handle/header: up → full, down → half → close.
 * Rendered in a portal so fixed parents can't trap it under the bottom nav.
 */
export function Sheet({ open, onClose, title, children, tall = false, backdrop = true }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; tall?: boolean; backdrop?: boolean;
}) {
  const [snap, setSnap] = useState<"half" | "full">(tall ? "full" : "half");
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);
  useEffect(() => { if (open) setSnap(tall ? "full" : "half"); }, [open, tall]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const end = () => {
    if (startY.current === null) return;
    if (drag < -50) setSnap("full");
    else if (drag > 70) { if (snap === "full" && !tall) setSnap("half"); else onClose(); }
    startY.current = null;
    setDrag(0);
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => { startY.current = e.clientY; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); },
    onPointerMove: (e: React.PointerEvent) => { if (startY.current !== null) setDrag(e.clientY - startY.current); },
    onPointerUp: end, onPointerCancel: end,
  };
  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col justify-end pointer-events-none" role="dialog" aria-modal={backdrop}>
      {backdrop && <button className="absolute inset-0 bg-navy/25 fade-in pointer-events-auto" aria-label="닫기" onClick={onClose} />}
      <div
        className="sheet-in pointer-events-auto relative bg-ivory rounded-t-[28px] shadow-[0_-8px_40px_rgba(30,42,68,.18)] w-full max-w-[640px] mx-auto flex flex-col"
        style={{
          height: snap === "full" ? "92dvh" : "58dvh",
          transform: drag ? `translateY(${Math.max(drag, -80)}px)` : undefined,
          transition: startY.current === null ? "height .28s cubic-bezier(.2,.8,.2,1), transform .2s" : "none",
          paddingBottom: "var(--sab)",
        }}
      >
        <div className="touch-none cursor-grab select-none" {...handlers}>
          <div className="pt-2.5 pb-1 flex justify-center"><span className="w-11 h-1.5 rounded-full bg-line" /></div>
          <div className="flex items-center gap-2 px-4 pb-2">
            <div className="flex-1 min-w-0 font-extrabold text-lg truncate">{title}</div>
            <button className="tap rounded-full text-muted hover:bg-sand flex items-center justify-center" onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose} aria-label="닫기"><Icon name="x" /></button>
          </div>
        </div>
        <div className="overflow-y-auto px-4 pb-6 flex-1 overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const MEMBER_COLORS = ["#2F6FDE", "#EE6C4D", "#0F8B8D", "#8E5CC8", "#C9821A"];
export function memberColor(index: number) { return MEMBER_COLORS[index % MEMBER_COLORS.length]; }

export function Avatar({ name, index = 0, size = 24, ring = false }: { name: string; index?: number; size?: number; ring?: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-full text-white font-bold shrink-0 ${ring ? "ring-2 ring-paper" : ""}`}
      style={{ width: size, height: size, background: memberColor(index), fontSize: size * 0.45 }} title={name} aria-label={name}>
      {name.slice(0, 1)}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "md" }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "md";
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 rounded-full px-3.5 ${size === "sm" ? "min-h-9 text-sm" : "min-h-11"} font-semibold border ${
            value === o.value ? "bg-navy text-white border-navy" : "bg-paper border-line text-navy-soft"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Header({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex items-end gap-3 mb-4">
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-muted mt-0.5">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "bad" }) {
  const cls = tone === "warn" ? "bg-[#FFF4E0] text-[#8A5A0F]" : tone === "bad" ? "bg-[#FDE8E6] text-bad" : "bg-sand text-navy-soft";
  return <div className={`rounded-xl px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
