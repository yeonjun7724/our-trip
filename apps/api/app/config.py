from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
KST = ZoneInfo("Asia/Seoul")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(REPO_ROOT / ".env", ".env"), extra="ignore")

    app_env: str = "development"
    database_url: str = "postgresql+psycopg://ourtrip@localhost:5544/ourtrip"
    session_secret: str = "dev-only-change-me"
    public_base_url: str = "http://localhost:8000"
    graph_data_dir: Path = REPO_ROOT / "data" / "graphs"
    web_dist_dir: Path = REPO_ROOT / "apps" / "web" / "dist"
    seed_dir: Path = REPO_ROOT / "data" / "seed"

    tago_api_key: str = ""
    odsay_api_key: str = ""

    transit_primary_provider: str = "odsay"
    enable_transit_api: bool = True
    enable_rail_api: bool = True
    enable_geocoding: bool = True

    # Short-lived in-memory reuse of identical requests. ODsay storage terms were not
    # confirmed, so its default is 0 (no reuse beyond merging concurrent duplicates).
    odsay_cache_seconds: int = 0
    tago_arrival_cache_seconds: int = 20

    session_days: int = 60
    invite_hours: int = 72
    # Optional shared entry code. Empty = anyone with the URL can open the shared trip.
    access_code: str = ""
    log_level: str = "INFO"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def sqlalchemy_url(self) -> str:
        url = self.database_url
        # Railway provides postgres:// or postgresql:// — use the psycopg3 driver.
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
