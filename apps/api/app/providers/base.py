"""Shared provider plumbing: error taxonomy, status tracking, rate limiting,
in-flight request merging, optional short TTL reuse, backoff and usage logging.

Usage logs never contain API keys or request parameters (coordinates etc.).
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Awaitable, Callable

import httpx

log = logging.getLogger("ourtrip.providers")


class ProviderError(Exception):
    code = "UPSTREAM_ERROR"
    user_message = "외부 교통정보를 지금 확인할 수 없어요."

    def __init__(self, detail: str = "", http_status: int | None = None):
        super().__init__(detail or self.code)
        self.detail = detail
        self.http_status = http_status


class NotConfigured(ProviderError):
    code = "NOT_CONFIGURED"
    user_message = "이 기능의 외부 API 키가 설정되지 않았어요."


class AuthFailed(ProviderError):
    code = "AUTH_FAILED"
    user_message = "외부 API 인증에 실패했어요. API 키 또는 등록 정보를 확인해 주세요."


class QuotaExceeded(ProviderError):
    code = "QUOTA_EXCEEDED"
    user_message = "외부 API 호출 한도를 넘었어요. 잠시 후 다시 시도해 주세요."


class NoData(ProviderError):
    code = "NO_DATA"
    user_message = "조회 결과가 없어요."


class BadRequest(ProviderError):
    code = "BAD_REQUEST"
    user_message = "조회 조건이 올바르지 않거나 공급자가 지원하지 않는 범위예요."


class Unsupported(ProviderError):
    code = "UNSUPPORTED"
    user_message = "이 지역 또는 조건은 공급자가 지원하지 않아요."


class Upstream(ProviderError):
    code = "UPSTREAM_ERROR"


UsageRecorder = Callable[[str, str, int | None, str, int], None]
_usage_recorder: UsageRecorder | None = None


def set_usage_recorder(fn: UsageRecorder | None) -> None:
    global _usage_recorder
    _usage_recorder = fn


@dataclass
class ProviderRuntime:
    name: str
    min_interval_s: float = 0.0           # client-side throttle between calls
    max_per_minute: int = 60
    configured: bool = False
    enabled: bool = True
    verified: bool = False                # True only after a real successful response
    last_success_at: datetime | None = None
    last_error_at: datetime | None = None
    last_error_code: str | None = None
    calls_today: int = 0
    _day: date = field(default_factory=date.today)
    _recent: deque = field(default_factory=deque)
    _last_call: float = 0.0
    _lock: asyncio.Lock | None = None
    _inflight: dict[str, asyncio.Future] = field(default_factory=dict)
    _cache: dict[str, tuple[float, Any]] = field(default_factory=dict)
    _cooldown_until: float = 0.0

    def status(self) -> dict:
        if not self.configured:
            state = "NOT_CONFIGURED"
        elif not self.enabled:
            state = "DISABLED"
        elif self._cooldown_until > time.monotonic():
            state = "COOLDOWN"
        elif self.last_error_code in ("AUTH_FAILED",):
            state = "AUTH_FAILED"
        elif self.verified:
            state = "VERIFIED"
        else:
            state = "CONFIGURED_UNVERIFIED"
        return {
            "provider": self.name, "state": state, "configured": self.configured,
            "enabled": self.enabled, "verified": self.verified,
            "last_success_at": self.last_success_at, "last_error_at": self.last_error_at,
            "last_error_code": self.last_error_code, "calls_today_this_instance": self.calls_today,
        }

    @property
    def usable(self) -> bool:
        return self.configured and self.enabled

    async def _throttle(self) -> None:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            now = time.monotonic()
            if self._cooldown_until > now:
                raise QuotaExceeded("provider cooling down after 429/limit")
            while self._recent and now - self._recent[0] > 60:
                self._recent.popleft()
            if len(self._recent) >= self.max_per_minute:
                raise QuotaExceeded("local per-minute limit")
            wait = self.min_interval_s - (now - self._last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call = time.monotonic()
            self._recent.append(self._last_call)
            if self._day != date.today():
                self._day, self.calls_today = date.today(), 0
            self.calls_today += 1

    async def call(self, key: str, category: str, fn: Callable[[], Awaitable[Any]],
                   cache_seconds: int = 0) -> Any:
        """Run fn with throttling, merge identical concurrent requests, optional TTL reuse."""
        if not self.configured:
            raise NotConfigured(self.name)
        if not self.enabled:
            raise NotConfigured(f"{self.name} disabled")
        if cache_seconds > 0:
            hit = self._cache.get(key)
            if hit and time.monotonic() - hit[0] < cache_seconds:
                return hit[1]
        if key in self._inflight:
            return await asyncio.shield(self._inflight[key])
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._inflight[key] = fut
        try:
            result = await self._run(category, fn)
            if cache_seconds > 0:
                self._cache[key] = (time.monotonic(), result)
                if len(self._cache) > 500:
                    self._cache.pop(next(iter(self._cache)))
            fut.set_result(result)
            return result
        except BaseException as exc:
            fut.set_exception(exc)
            fut.exception()  # mark retrieved
            raise
        finally:
            self._inflight.pop(key, None)

    async def _run(self, category: str, fn: Callable[[], Awaitable[Any]]) -> Any:
        delay = 0.6
        for attempt in range(3):
            await self._throttle()
            t0 = time.monotonic()
            status_code: int | None = None
            try:
                result = await fn()
                self.verified = True
                self.last_success_at = datetime.now(timezone.utc)
                self.last_error_code = None
                self._record(category, 200, "OK", t0)
                return result
            except NoData:
                self.verified = True
                self.last_success_at = datetime.now(timezone.utc)
                self._record(category, 200, "NO_DATA", t0)
                raise
            except ProviderError as exc:
                status_code = exc.http_status
                self._mark_error(exc)
                self._record(category, status_code, exc.code, t0)
                if isinstance(exc, QuotaExceeded):
                    self._cooldown_until = time.monotonic() + 60
                    raise
                if isinstance(exc, Upstream) and attempt < 2 and (status_code is None or status_code >= 500):
                    await asyncio.sleep(delay)
                    delay *= 2
                    continue
                raise
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                err = Upstream(f"network: {type(exc).__name__}")
                self._mark_error(err)
                self._record(category, None, "NETWORK", t0)
                if attempt < 2:
                    await asyncio.sleep(delay)
                    delay *= 2
                    continue
                raise err from exc
        raise Upstream("retries exhausted")

    def _mark_error(self, exc: ProviderError) -> None:
        self.last_error_at = datetime.now(timezone.utc)
        self.last_error_code = exc.code

    def _record(self, category: str, status: int | None, outcome: str, t0: float) -> None:
        ms = int((time.monotonic() - t0) * 1000)
        log.info("provider=%s category=%s outcome=%s status=%s ms=%s", self.name, category, outcome, status, ms)
        if _usage_recorder:
            try:
                _usage_recorder(self.name, category, status, outcome, ms)
            except Exception:  # logging must never break a request
                log.exception("usage log failed")


def http_client(timeout: float = 10.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=5.0),
                             headers={"User-Agent": "OurTrip/0.1"})
