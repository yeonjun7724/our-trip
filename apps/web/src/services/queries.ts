import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import type { Itinerary, Place, Reservation, Trip } from "./types";

// Two people editing from two phones: poll + refetch on focus; invalidate after every mutation.
const POLL = 15_000;

export interface Me { authenticated: boolean; member?: { id: string; nickname: string; role: string }; trip_id?: string }

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/me"), staleTime: 60_000 });

export function useTripId(): string | undefined {
  return useMe().data?.trip_id;
}

export const useTrip = (id?: string) =>
  useQuery({ queryKey: ["trip", id], queryFn: () => api.get<Trip>(`/api/trips/${id}`), enabled: !!id, refetchInterval: POLL });

export const usePlaces = (id?: string) =>
  useQuery({ queryKey: ["places", id], queryFn: () => api.get<Place[]>(`/api/trips/${id}/places`), enabled: !!id, refetchInterval: POLL });

export const useItinerary = (id?: string) =>
  useQuery({ queryKey: ["itinerary", id], queryFn: () => api.get<Itinerary>(`/api/trips/${id}/itinerary`), enabled: !!id, refetchInterval: POLL });

export const useReservations = (id?: string) =>
  useQuery({ queryKey: ["rail-res", id], queryFn: () => api.get<Reservation[]>(`/api/trips/${id}/rail-reservations`), enabled: !!id, refetchInterval: POLL });

export interface Activity { id: number; action: string; summary: string; member: string | null; is_me: boolean; created_at: string }
export const useActivity = (id?: string) =>
  useQuery({ queryKey: ["activity", id], queryFn: () => api.get<Activity[]>(`/api/trips/${id}/activity?limit=15`), enabled: !!id, refetchInterval: POLL });

export interface PassInfo {
  pass_type: string; rail_day_count: number; allowed_days: number | null; unreserved_trains: number; warnings: string[];
  rail_days: { date: string | null; trains: { id: string; train?: string; route?: string; reservation_status?: string }[] }[];
  disclaimer: string; official_url: string;
}
export const usePass = (id?: string) =>
  useQuery({ queryKey: ["pass", id], queryFn: () => api.get<PassInfo>(`/api/trips/${id}/rail-pass`), enabled: !!id, refetchInterval: POLL });

export function useInvalidateTrip() {
  const qc = useQueryClient();
  return () => {
    ["trip", "places", "itinerary", "activity", "rail-res", "pass"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
}

/** Mutation that refreshes all shared trip data afterwards, and refreshes on version conflict too. */
export function useTripMutation<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, onDone?: (r: TRes) => void) {
  const inv = useInvalidateTrip();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => { inv(); onDone?.(r); },
    onError: (e) => { if (e instanceof ApiError && e.status === 409) inv(); },
  });
}
