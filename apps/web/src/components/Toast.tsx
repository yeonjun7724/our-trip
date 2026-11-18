import { createPortal } from "react-dom";
import { create } from "zustand";

interface ToastItem { id: number; text: string; tone: "ok" | "warn" | "bad" }
interface ToastState { items: ToastItem[]; push: (text: string, tone?: ToastItem["tone"]) => void }

let seq = 0;
export const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (text, tone = "ok") => {
    const id = ++seq;
    set((s) => ({ items: [...s.items.slice(-2), { id, text, tone }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 2600);
  },
}));

/** Short confirmation + light haptic tick where supported (Android). */
export function toast(text: string, tone: ToastItem["tone"] = "ok") {
  useToasts.getState().push(text, tone);
  try { navigator.vibrate?.(tone === "ok" ? 12 : [20, 40, 20]); } catch { /* not supported */ }
}

export function Toaster() {
  const items = useToasts((s) => s.items);
  return createPortal(
    <div className="fixed inset-x-0 z-[60] flex flex-col items-center gap-2 pointer-events-none px-4"
      style={{ bottom: "calc(var(--nav-h) + var(--nav-gap) + var(--sab) + 14px)" }} aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast-in pointer-events-auto w-full max-w-[480px] rounded-[16px] px-4 py-3.5 text-[15px] font-medium shadow-[0_8px_24px_rgba(0,0,0,.18)] flex items-center gap-2.5 bg-[#333D4B]/95 text-white backdrop-blur`}>
          <span aria-hidden className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[12px] font-bold ${
            t.tone === "ok" ? "bg-coral" : t.tone === "warn" ? "bg-warn" : "bg-bad"}`}>{t.tone === "ok" ? "✓" : "!"}</span>{t.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}
