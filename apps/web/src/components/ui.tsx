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
    <div className="card px-6 py-10 text-center">
      <div className="mx-auto w-[72px] h-[72px] rounded-full bg-sand flex items-center justify-center text-[34px] mb-4" aria-hidden>{icon}</div>
      <p className="font-bold text-[18px] tracking-[-0.02em]">{title}</p>
      {body && <p className="text-[15px] text-muted mt-1.5 leading-relaxed">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : "문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
  const offline = error instanceof ApiError && error.code === "NETWORK";
  return (
    <div className="card p-5" role="alert">
      <p className="font-bold text-[17px] flex items-center gap-1.5">{offline ? "📡 오프라인 상태예요" : "⚠️ 불러오지 못했어요"}</p>
      <p className="text-[15px] text-navy-soft mt-1">{msg}</p>
      {retry && <button className="btn btn-ghost mt-4 w-full" onClick={retry}>다시 시도</button>}
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : "요청을 처리하지 못했어요.";
  return <p className="text-sm text-bad mt-2" role="alert">{msg}</p>;
}

const STATUS_STYLE: Record<DataStatus, string> = {
  USER_ENTERED: "bg-sand text-navy-soft", VERIFIED_STATIC: "bg-coral-soft text-[#1B64DA]", SCHEDULED: "bg-[#E5F8EF] text-ok",
  LIVE: "bg-[#E5F8EF] text-ok", ESTIMATED: "bg-[#FFF3E0] text-warn", UNAVAILABLE: "bg-sand text-muted", STALE: "bg-[#FFEEF0] text-bad",
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
      {backdrop && <button className="absolute inset-0 bg-black/40 fade-in pointer-events-auto" aria-label="닫기" onClick={onClose} />}
      <div
        className="sheet-in pointer-events-auto relative bg-paper rounded-t-[24px] shadow-[0_-4px_24px_rgba(0,0,0,.08)] w-full max-w-[640px] mx-auto flex flex-col"
        style={{
          height: snap === "full" ? "92dvh" : "58dvh",
          transform: drag ? `translateY(${Math.max(drag, -80)}px)` : undefined,
          transition: startY.current === null ? "height .28s cubic-bezier(.2,.8,.2,1), transform .2s" : "none",
          paddingBottom: "var(--sab)",
        }}
      >
        <div className="touch-none cursor-grab select-none" {...handlers}>
          <div className="pt-2.5 pb-1 flex justify-center"><span className="w-10 h-1 rounded-full bg-[#D1D6DB]" /></div>
          <div className="flex items-center gap-2 pl-5 pr-3 pt-1 pb-3">
            <div className="flex-1 min-w-0 font-bold text-[20px] tracking-[-0.02em] truncate">{title}</div>
            <button className="tap rounded-full text-muted hover:bg-sand flex items-center justify-center" onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose} aria-label="닫기"><Icon name="x" /></button>
          </div>
        </div>
        <div className="overflow-y-auto px-5 pb-6 flex-1 overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const MEMBER_COLORS = ["#3182F6", "#FF6B8A", "#00B8A9", "#8B6CEF", "#F5A623"];
export function memberColor(index: number) { return MEMBER_COLORS[index % MEMBER_COLORS.length]; }

export function Avatar({ name, index = 0, size = 24, ring = false }: { name: string; index?: number; size?: number; ring?: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-full text-white font-bold shrink-0 ${ring ? "ring-2 ring-paper" : ""}`}
      style={{ width: size, height: size, background: memberColor(index), fontSize: size * 0.45 }} title={name} aria-label={name}>
      {name.slice(0, 1)}
    </span>
  );
}

/** md = iOS-style track (primary tabs), sm = chips (filters). */
export function Segmented<T extends string>({ value, options, onChange, size = "md" }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "md";
}) {
  if (size === "md") {
    return (
      <div className="bg-[#E9ECEF] rounded-[14px] p-1 flex gap-1 overflow-x-auto no-scrollbar" role="tablist">
        {options.map((o) => (
          <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
            className={`shrink-0 flex-1 min-w-fit whitespace-nowrap px-3.5 min-h-10 rounded-[11px] text-[15px] font-semibold transition-all duration-200 ${
              value === o.value ? "bg-paper text-navy shadow-[0_1px_3px_rgba(0,0,0,.1)]" : "text-muted"}`}>
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={`shrink-0 rounded-full px-3.5 min-h-9 text-[14px] font-semibold transition-colors ${
            value === o.value ? "bg-navy text-white" : "bg-paper text-navy-soft"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Large title that collapses into a sticky, blurred compact bar on scroll (iOS pattern). */
export function Header({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    // scroll position, not IntersectionObserver: the page entrance animation made the observer misfire at the top
    const onScroll = () => setCompact(window.scrollY > 56);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <>
      <div className={`fixed top-0 inset-x-0 z-20 glass transition-all duration-200 ${compact ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"}`}
        style={{ paddingTop: "var(--sat)" }} aria-hidden={!compact}>
        <div className="max-w-[640px] mx-auto h-12 px-4 flex items-center gap-2">
          <p className="flex-1 text-center font-bold truncate">{title}</p>
        </div>
      </div>
      <header className="flex items-end gap-3 mb-6 pt-2">
        <div className="flex-1 min-w-0">
          <h1 className="text-[26px] leading-[1.3] font-bold tracking-[-0.03em]">{title}</h1>
          {sub && <p className="text-[15px] text-muted mt-1">{sub}</p>}
        </div>
        {right}
      </header>
    </>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "bad" }) {
  const cls = tone === "warn" ? "bg-[#FFF3E0] text-[#9A5B00]" : tone === "bad" ? "bg-[#FFEEF0] text-[#D22030]" : "bg-sand text-navy-soft";
  return <div className={`rounded-[14px] px-4 py-3 text-[14px] leading-relaxed ${cls}`}>{children}</div>;
}
