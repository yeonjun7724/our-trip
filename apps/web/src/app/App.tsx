import { lazy, Suspense, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Icon, { type IconName } from "@/components/Icon";
import { toast, Toaster } from "@/components/Toast";
import { useMe } from "@/services/queries";
import { ErrorState, Sheet, Skeleton } from "@/components/ui";
import HomePage from "@/features/home/HomePage";
import { IdentityGate } from "@/features/onboarding/Onboarding";

const MapPage = lazy(() => import("@/features/map/MapPage"));
const WishlistPage = lazy(() => import("@/features/wishlist/WishlistPage"));
const AddPlacePage = lazy(() => import("@/features/places/AddPlacePage"));
const TransitPage = lazy(() => import("@/features/transit/TransitPage"));
const ItineraryPage = lazy(() => import("@/features/itinerary/ItineraryPage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "지도", icon: "map" },
  { to: "/wishlist", label: "위시", icon: "heart" },
  { to: "/itinerary", label: "일정", icon: "calendar" },
  { to: "/transit", label: "교통", icon: "train" },
];

function BottomNav() {
  const [addOpen, setAddOpen] = useState(false);
  const nav = useNavigate();
  const item = (n: (typeof NAV)[number]) => (
    <li key={n.to}>
      <NavLink to={n.to} end={n.to === "/"}
        className={({ isActive }) => `h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${isActive ? "text-coral" : "text-muted"}`}>
        {({ isActive }) => (<>
          <span className={`flex items-center justify-center w-12 h-7 rounded-full transition-colors ${isActive ? "bg-coral-soft" : ""}`}>
            <Icon name={n.icon} size={22} stroke={isActive ? 2.4 : 1.9} />
          </span>
          {n.label}
        </>)}
      </NavLink>
    </li>
  );
  return (
    <>
      <nav className="fixed bottom-0 inset-x-0 z-30 glass border-t border-line" style={{ paddingBottom: "var(--sab)" }} aria-label="주요 메뉴">
        <ul className="grid grid-cols-5 max-w-[640px] mx-auto h-[var(--nav-h)]">
          {item(NAV[0])}{item(NAV[1])}
          <li className="flex items-center justify-center">
            <button onClick={() => setAddOpen(true)} aria-label="장소 추가"
              className="w-14 h-14 -mt-6 rounded-full bg-coral text-white shadow-float flex items-center justify-center active:scale-95 transition-transform ring-4 ring-ivory">
              <Icon name="plus" size={28} stroke={2.6} />
            </button>
          </li>
          {item(NAV[2])}{item(NAV[3])}
        </ul>
      </nav>
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="장소 추가">
        <div className="grid gap-2.5">
          {([
            ["📍", "지도에서 바로 찍기", "지도의 원하는 곳을 누르면 그 자리에 저장돼요", () => { nav("/"); toast("지도에서 원하는 곳을 눌러 주세요"); }],
            ["🔎", "이름으로 찾기", "지도 위 검색창에서 이름을 입력하세요", () => { nav("/"); setTimeout(() => (document.querySelector("input[aria-label='장소 검색']") as HTMLInputElement | null)?.focus(), 300); }],
            ["🔗", "네이버·카카오 링크 붙여넣기", "공유 링크를 북마크로 저장하고 위치를 지정해요", () => nav("/places/new")],
          ] as const).map(([e, t, d, fn]) => (
            <button key={t} className="card p-4 flex items-center gap-3 text-left active:bg-sand" onClick={() => { setAddOpen(false); fn(); }}>
              <span className="text-2xl w-10 text-center">{e}</span>
              <span className="flex-1"><b>{t}</b><br /><span className="text-sm text-muted">{d}</span></span>
              <Icon name="chevronR" className="text-muted" />
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

function PageFallback() {
  return <div className="page space-y-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>;
}

function Authed({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <PageFallback />;
  if (me.error) return <div className="page"><ErrorState error={me.error} retry={() => me.refetch()} /></div>;
  if (!me.data?.authenticated) return <IdentityGate />;
  return (
    <>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
      <BottomNav />
    </>
  );
}

/** Web Share Target (Android): /share?title=&text=&url= → add-place form. */
function ShareTarget() {
  const p = new URLSearchParams(useLocation().search);
  const text = [p.get("title"), p.get("text"), p.get("url")].filter(Boolean).join("\n");
  return <Navigate to={`/places/new?text=${encodeURIComponent(text)}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        <Route path="/share" element={<ShareTarget />} />
        <Route path="/" element={<Authed><MapPage /></Authed>} />
        <Route path="/home" element={<Authed><HomePage /></Authed>} />
        <Route path="/map" element={<Navigate to="/" replace />} />
        <Route path="/wishlist" element={<Authed><WishlistPage /></Authed>} />
        <Route path="/places/new" element={<Authed><AddPlacePage /></Authed>} />
        <Route path="/transit" element={<Authed><TransitPage /></Authed>} />
        <Route path="/itinerary" element={<Authed><ItineraryPage /></Authed>} />
        <Route path="/settings" element={<Authed><SettingsPage /></Authed>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
