from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api import itinerary, places, rail, together, transit, trips
from .config import get_settings
from .db import get_engine
from .errors import AppError
from .providers import base as provider_base
from .providers import provider_registry
from .routing import osmnx_engine

log = logging.getLogger("ourtrip")


def _record_usage(provider: str, category: str, status: int | None, outcome: str, ms: int) -> None:
    from sqlalchemy.orm import Session

    from .models import ApiUsageLog
    with Session(get_engine()) as s:
        s.add(ApiUsageLog(provider=provider, endpoint_category=category, status_code=status, outcome=outcome,
                          latency_ms=ms, request_date=datetime.now(timezone.utc).date()))
        s.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    logging.basicConfig(level=s.log_level)
    if s.is_production and s.session_secret == "dev-only-change-me":
        raise RuntimeError("SESSION_SECRET must be set in production")
    provider_registry.configure_all()
    provider_base.set_usage_recorder(_record_usage)
    reg = osmnx_engine.registry()
    log.info("walk graph zones: %s", list(reg.zones))
    if s.app_env != "test":
        import threading

        def warm():
            for z in list(reg.zones):
                try:
                    reg.get(z)
                except Exception:
                    log.exception("graph %s failed to load", z)
        threading.Thread(target=warm, daemon=True).start()
    yield
    provider_base.set_usage_recorder(None)


app = FastAPI(title="Our Trip API", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def origin_guard(request: Request, call_next):
    """CSRF defence in depth (cookies are SameSite=Lax): reject cross-origin unsafe requests."""
    if request.method in ("POST", "PATCH", "PUT", "DELETE") and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin")
        if origin:
            host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
            allowed = {urlparse(get_settings().public_base_url).netloc, host}
            if urlparse(origin).netloc not in allowed:
                return JSONResponse(status_code=403, content={"error": {"code": "BAD_ORIGIN",
                                                                         "message": "허용되지 않은 출처의 요청이에요."}})
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(AppError)
async def app_error(_: Request, exc: AppError):
    return JSONResponse(status_code=exc.status, content=jsonable_encoder(exc.body()))


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"error": {
        "code": "VALIDATION_ERROR", "message": "입력값을 확인해 주세요.",
        "details": [{"loc": list(e.get("loc", [])), "msg": e.get("msg")} for e in exc.errors()]}})


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": {
        "code": "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR", "message": str(exc.detail)}})


for r in (trips.router, places.router, itinerary.router, rail.router, transit.router, together.router):
    app.include_router(r)


@app.get("/api/health")
def health():
    db_ok = True
    try:
        with get_engine().connect() as c:
            c.execute(text("select 1"))
    except Exception:
        db_ok = False
    reg = osmnx_engine.registry()
    return JSONResponse(status_code=200 if db_ok else 503, content={
        "status": "ok" if db_ok else "degraded", "database": db_ok, "walk_graph_zones": len(reg.zones),
        "time": datetime.now(timezone.utc).isoformat()})


# ---------- SPA static files ----------
def _dist() -> Path:
    return get_settings().web_dist_dir


@app.get("/{full_path:path}", include_in_schema=False)
async def spa(full_path: str):
    if full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"error": {"code": "NOT_FOUND", "message": "없는 API예요."}})
    dist = _dist().resolve()
    target = (dist / full_path).resolve()
    if full_path and target.is_file() and dist in target.parents:
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if "/assets/" in f"/{full_path}" else {}
        if full_path in ("sw.js", "manifest.webmanifest"):
            headers = {"Cache-Control": "no-cache"}
        return FileResponse(target, headers=headers)
    index = dist / "index.html"
    if index.exists():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return JSONResponse(status_code=503, content={"error": {"code": "WEB_NOT_BUILT",
                                                            "message": "프론트엔드 빌드가 없어요 (apps/web: npm run build)."}})
