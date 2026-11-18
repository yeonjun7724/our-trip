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
      style={{ top: "calc(var(--sat) + 12px)" }} aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast-in pointer-events-auto rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg flex items-center gap-2 ${
          t.tone === "ok" ? "bg-navy text-white" : t.tone === "warn" ? "bg-warn text-white" : "bg-bad text-white"}`}>
          <span aria-hidden>{t.tone === "ok" ? "✓" : "!"}</span>{t.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}
