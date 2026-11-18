export interface LineGeom { type: "LineString"; coordinates: number[][] }
export type City = "busan" | "gyeongju" | "pohang" | "other";
export type Pref = "MUST" | "GOOD" | "MAYBE" | "SKIP";
export type DataStatus = "USER_ENTERED" | "VERIFIED_STATIC" | "SCHEDULED" | "LIVE" | "ESTIMATED" | "UNAVAILABLE" | "STALE";

export interface Member { id: string; nickname: string; role: "OWNER" | "MEMBER"; is_me?: boolean }
export interface Day {
  id: string; day_number: number; travel_date: string | null; primary_city: City; primary_city_label: string;
  start_time: string; lodging_place_id: string | null; version: number;
}
export interface Trip {
  id: string; title: string; start_date: string | null; end_date: string | null; timezone: string;
  departure_station_id: string | null; departure_station_name: string | null;
  return_station_id: string | null; return_station_name: string | null;
  rail_pass_type: "SELECT_3" | "CONTINUOUS_7" | "UNDECIDED"; station_buffer_minutes: number; walking_speed_kmh: number;
  version: number; members: Member[]; days: Day[];
}
export interface Vote { member_id: string; nickname: string; preference: Pref | null; is_me: boolean }
export interface Link { label: string; url: string }
export interface Place {
  id: string; name: string; city: City; city_label: string; category: string;
  latitude: number | null; longitude: number | null; coordinate_source: string; has_location: boolean;
  osm_ref: string | null; share_url: string | null; provider: string; provider_place_id: string | null;
  memo: string | null; stay_minutes: number; created_by: string | null; created_by_me: boolean; created_by_id: string | null;
  updated_by: string | null; updated_at: string; version: number; votes: Vote[]; my_vote: Pref | null;
  priority_score: number; both_want: boolean; excluded: boolean; planned_day: number | null; external_links: Link[];
}
export interface Freshness { status: DataStatus; provider: string; fetched_at?: string | null; note?: string | null }

export interface Leg {
  leg_id?: string; mode: string; duration_minutes: number | null; distance_m?: number; status: string; source?: string;
  summary?: string; reason?: string; warnings?: string[]; suggest_transit?: boolean; transfer_count?: number | null;
  checked_at?: string;
}
export interface TimelineEntry {
  item_id: string; kind: "PLACE" | "RAIL"; name: string; place_id?: string; category?: string; has_location?: boolean;
  leg_in: Leg | null; arrival: string | null; start?: string | null; end?: string | null; stay_minutes?: number;
  is_fixed: boolean; visit_status: string; version: number; conflict?: string | null; time_status: string;
  rail_reservation_id?: string; origin?: string; destination?: string; arrival_at_station?: string | null;
  departure?: string | null; buffer_minutes?: number; slack_minutes?: number | null; connection?: string;
  connection_label?: string; connection_note?: string; schedule_source?: string; reservation_status?: string;
}
export interface ItineraryDay {
  id: string; day_number: number; travel_date: string | null; primary_city: City; primary_city_label: string;
  start_time: string; version: number; lodging: { id: string; name: string; has_location: boolean } | null;
  entries: TimelineEntry[]; end: string | null; walk_distance_m: number; warnings: string[]; unknown_legs: number;
}
export interface Itinerary { trip_id: string; buffer_minutes: number; days: ItineraryDay[]; unassigned: Place[]; notes: string[] }

export interface StopSource { provider: "TAGO" | "OSM"; stop_id: string; city_code?: string | null; realtime_supported: boolean | null }
export interface Stop {
  key: string; name: string | null; kind: "BUS" | "SUBWAY" | "RAIL"; lat: number; lon: number;
  straight_distance_m: number; walk_distance_m: number | null; walk_minutes: number | null; walk_status: string;
  stop_number: string | null; routes: string[] | null; sources: StopSource[]; freshness: Freshness;
}
export interface RouteLeg {
  mode: string; duration_minutes: number | null; distance_m: number | null; start_name?: string | null; end_name?: string | null;
  start?: { lat: number; lon: number } | null; end?: { lat: number; lon: number } | null; line_name?: string | null;
  line_color?: string | null; stop_count?: number | null; geometry?: LineGeom | null; geometry_source?: string | null;
}
export interface RouteOption {
  option_id: string; provider: string; total_minutes: number | null; fare_krw: number | null; transfer_count: number | null;
  walk_distance_m: number | null; legs: RouteLeg[]; lines: string[]; geometry_ref?: string | null; has_geometry: boolean;
}
export interface TransitResult {
  status: string; message?: string | null; provider?: string | null; time_basis: string; time_basis_note?: string | null;
  options: RouteOption[]; attribution?: string | null; freshness: Freshness; external_links: Link[];
}
export interface Train {
  train_no: string | null; train_type: string | null; origin_name: string | null; destination_name: string | null;
  departure: string | null; arrival: string | null; duration_minutes: number | null; adult_fare_krw: number | null;
}
export interface Reservation {
  id: string; train_number: string | null; train_type: string | null; origin_station_id: string | null;
  origin_station_name: string; destination_station_id: string | null; destination_station_name: string;
  travel_date: string | null; scheduled_departure: string | null; scheduled_arrival: string | null;
  schedule_source: string; schedule_checked_at: string | null; reservation_status: "PLANNED" | "RESERVED" | "CANCELLED";
  user_notes: string | null; origin_lat: number | null; origin_lon: number | null; destination_lat: number | null;
  destination_lon: number | null; version: number; status_label: string;
}

