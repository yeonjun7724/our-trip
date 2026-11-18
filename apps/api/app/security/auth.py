"""Session + invite tokens. Only SHA-256 hashes of tokens are stored in the DB."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..errors import AppError
from ..models import MemberSession, TripMember

COOKIE = "ourtrip_session"


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    key = get_settings().session_secret.encode()
    return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def start_session(db: Session, response: Response, member: TripMember) -> None:
    s = get_settings()
    token = new_token()
    db.add(MemberSession(member_id=member.id, token_hash=hash_token(token),
                         expires_at=utcnow() + timedelta(days=s.session_days)))
    response.set_cookie(
        COOKIE, token, max_age=s.session_days * 86400, httponly=True,
        secure=s.is_production, samesite="lax", path="/",
    )


def end_session(db: Session, request: Request, response: Response) -> None:
    token = request.cookies.get(COOKIE)
    if token:
        sess = db.scalar(select(MemberSession).where(MemberSession.token_hash == hash_token(token)))
        if sess:
            sess.revoked_at = utcnow()
    response.delete_cookie(COOKIE, path="/")


def optional_member(request: Request, db: Session = Depends(get_db)) -> TripMember | None:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    sess = db.scalar(select(MemberSession).where(MemberSession.token_hash == hash_token(token)))
    if not sess or sess.revoked_at or aware(sess.expires_at) < utcnow():
        return None
    return sess.member


def current_member(member: TripMember | None = Depends(optional_member)) -> TripMember:
    if member is None:
        raise AppError(401, "AUTH_REQUIRED", "여행방에 참여한 뒤 이용할 수 있어요.")
    return member


def ensure_trip(member: TripMember, trip_id: str) -> None:
    if member.trip_id != trip_id:
        # Don't reveal whether the other trip exists.
        raise AppError(404, "TRIP_NOT_FOUND", "여행방을 찾을 수 없거나 접근 권한이 없어요.")
