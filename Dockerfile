# ---- 1) build the React app ----
FROM node:22.11.0-slim AS web
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web/ ./
RUN npx vite build

# ---- 2) Python runtime (FastAPI serves API + built SPA) ----
FROM python:3.12.8-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /bin/uv
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app/apps/api
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/api/ ./
# Prebuilt, verified OSMnx walk graphs (ODbL, built by scripts/build_walk_graphs.py) — no Overpass calls at runtime
COPY data/graphs/*.graphml data/graphs/*.geojson data/graphs/manifest.json /app/data/graphs/
COPY data/seed/ /app/data/seed/
COPY --from=web /web/dist /app/apps/web/dist
ENV PATH="/app/apps/api/.venv/bin:$PATH" \
    APP_ENV=production \
    GRAPH_DATA_DIR=/app/data/graphs \
    WEB_DIST_DIR=/app/apps/web/dist \
    SEED_DIR=/app/data/seed
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
