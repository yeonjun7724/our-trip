"""Provider-neutral transit models. Every provider adapter normalizes into these."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from .common import ExternalLink, Freshness

Mode = Literal["WALK", "BUS", "SUBWAY", "TRAIN", "EXPRESS_BUS", "INTERCITY_BUS", "AIR", "FERRY",
               "TAXI_EXTERNAL", "UNKNOWN"]


class StopSourceRef(BaseModel):
    provider: Literal["TAGO", "OSM"]
    stop_id: str               # provider-native ID, never converted between providers
    city_code: str | None = None
    realtime_supported: bool | None = None  # None = unknown


class TransportStop(BaseModel):
    key: str                   # stable key for UI, e.g. "TAGO:21:BSB123" or "OSM:node/1"
    name: str | None
    kind: Literal["BUS", "SUBWAY", "RAIL"]
    lat: float
    lon: float
    straight_distance_m: float
    walk_distance_m: float | None = None
    walk_minutes: float | None = None
    walk_status: Literal["OK", "NO_PATH", "OUT_OF_GRAPH", "NOT_COMPUTED"] = "NOT_COMPUTED"
    stop_number: str | None = None
    routes: list[str] | None = None  # None = not loaded / unknown; [] = provider says none
    sources: list[StopSourceRef]
    freshness: Freshness


class NearbyStopsResponse(BaseModel):
    origin: dict
    radius_m: int
    stops: list[TransportStop]
    source_notes: list[str]
    providers: dict[str, str]  # provider -> OK | NOT_CONFIGURED | UNAVAILABLE | ...


class ArrivalPrediction(BaseModel):
    route_id: str | None
    route_no: str | None
    route_type: str | None
    arrival_seconds: int | None
    remaining_stops: int | None
    vehicle_type: str | None


class ArrivalsResponse(BaseModel):
    stop_key: str
    status: Literal["OK", "EMPTY", "UNSUPPORTED_STOP", "UNSUPPORTED_REGION", "NOT_CONFIGURED",
                    "QUOTA_EXCEEDED", "AUTH_FAILED", "UPSTREAM_ERROR"]
    message: str | None = None
    arrivals: list[ArrivalPrediction] = []
    freshness: Freshness


class RouteLeg(BaseModel):
    mode: Mode
    duration_minutes: float | None
    distance_m: float | None
    start_name: str | None = None
    end_name: str | None = None
    start: dict | None = None  # {"lat","lon"}
    end: dict | None = None
    line_name: str | None = None
    line_color: str | None = None  # only when the provider supplied it
    stop_count: int | None = None
    geometry: dict | None = None  # GeoJSON LineString when the provider (or OSMnx) supplied it
    geometry_source: str | None = None
    provider_refs: dict[str, Any] | None = None


class RouteOption(BaseModel):
    option_id: str
    provider: Literal["ODSAY"]
    total_minutes: float | None
    fare_krw: int | None
    transfer_count: int | None
    walk_distance_m: float | None
    legs: list[RouteLeg]
    lines: list[str]
    geometry_ref: str | None = None  # e.g. ODsay mapObj, fetched only on demand
    has_geometry: bool = False


class TransitRouteResponse(BaseModel):
    status: Literal["OK", "NO_ROUTE", "TOO_CLOSE", "NOT_CONFIGURED", "QUOTA_EXCEEDED", "UNAVAILABLE"]
    message: str | None = None
    provider: str | None = None
    attempted: list[dict] = []
    time_basis: Literal["CURRENT", "REQUESTED", "NONE"] = "NONE"
    time_basis_note: str | None = None
    requested_departure: datetime | None = None
    options: list[RouteOption] = []
    attribution: str | None = None
    freshness: Freshness
    external_links: list[ExternalLink] = []
