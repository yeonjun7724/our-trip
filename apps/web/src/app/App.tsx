import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useMe } from "@/services/queries";
import { ErrorState, Skeleton } from "@/components/ui";
import HomePage from "@/features/home/HomePage";
import { IdentityGate } from "@/features/onboarding/Onboarding";

const MapPage = lazy(() => import("@/features/map/MapPage"));
const WishlistPage = lazy(() => import("@/features/wishlist/WishlistPage"));
const AddPlacePage = lazy(() => import("@/features/places/AddPlacePage"));
const TransitPage = lazy(() => import("@/features/transit/TransitPage"));
const ItineraryPage = lazy(() => import("@/features/itinerary/ItineraryPage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));

const NAV = [
  { to: "/", label: "지도", icon: "M9 4l6 2 6-2v16l-6 2-6-2-6 2V6zM9 4v16M15 6v16" },
  { to: "/wishlist", label: "위시", icon: "M12 21s-7-4.4-9.3-9A5 5 0 0 1 12 6a5 5 0 0 1 9.3 6c-2.3 4.6-9.3 9-9.3 9z" },
  { to: "/transit", label: "교통", icon: "M6 3h12a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM4 11h16M8 21l2-3M16 21l-2-3M8 14.5h.01M16 14.5h.01" },
  { to: "/itinerary", label: "일정", icon: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 12h4M8 16h7" },
  { to: "/home", label: "요약", icon: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" },
];

function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-paper/95 backdrop-blur border-t border-line"
         style={{ paddingBottom: "var(--sab)" }} aria-label="주요 메뉴">
      <ul className="grid grid-cols-5 max-w-[640px] mx-auto h-[var(--nav-h)]">
        {NAV.map((n) => (
          <li key={n.to}>
            <NavLink to={n.to} end={n.to === "/"}
              className={({ isActive }) => `h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${isActive ? "text-coral" : "text-muted"}`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={n.icon} /></svg>
              {n.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
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
