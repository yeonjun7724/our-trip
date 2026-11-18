import { create } from "zustand";
import type { City } from "@/services/types";

/** UI-only state (filters/selection). Shared trip data lives in TanStack Query. */
interface MapUi {
  city: City | "all";
  day: number | "all";
  category: string | "all";
  creator: "all" | "me" | "partner";
  scheduled: "all" | "yes" | "no";
  hideVisited: boolean;
  showStops: boolean;
  selectedPlaceId: string | null;
  set: (p: Partial<Omit<MapUi, "set">>) => void;
}

export const useMapUi = create<MapUi>((set) => ({
  city: "all", day: "all", category: "all", creator: "all", scheduled: "all", hideVisited: false, showStops: false,
  selectedPlaceId: null,
  set: (p) => set(p),
}));
