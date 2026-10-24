"""刷新会话使用独立 HttpOnly Cookie，数据库仅保存摘要。"""

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from hmac import compare_digest
from secrets import token_urlsafe
from uuid import UUID, uuid4

from fastapi import HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.core.config import get_settings
from genesis_api.identity.models import AuthSession, User
from genesis_api.identity.tokens import access_claims, create_access_token


def active(session: AuthSession) -> bool:
    """兼容 SQLite 无时区时间与 PostgreSQL 的 UTC 时间。"""
    return session.revoked_at is None and session.expires_at.replace(tzinfo=UTC) > datetime.now(UTC)


def cookie_name(session_id: UUID) -> str:
    """按会话隔离 Cookie，允许账户页与作者工作台使用不同账号。"""
    return f"genesis_refresh_{session_id.hex}"


def rotate_cookie(item: AuthSession, response: Response) -> None:
    """每次刷新换发随机值，并从刷新时刻重新计算一天有效期。"""
    settings = get_settings()
    token = token_urlsafe(32)
    item.refresh_hash = sha256(token.encode()).hexdigest()
    seconds = settings.jwt_refresh_token_expire_minutes * 60
    item.expires_at = datetime.now(UTC) + timedelta(seconds=seconds)
    response.set_cookie(
        cookie_name(item.id),
        token,
        max_age=seconds,
        path=settings.api_v1_prefix + "/auth",
        secure=settings.environment != "development",
        httponly=True,
        samesite="strict",
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def start_session(user: User, session: Session, response: Response) -> str:
    """登录成功后创建会话，不在响应 JSON 中暴露刷新凭据。"""
    item = AuthSession(id=uuid4(), user_id=user.id)
    rotate_cookie(item, response)
    session.add(item)
    session.commit()
    return create_access_token(user, item.id)


def session_from_request(request: Request, session: Session) -> AuthSession | None:
    """签名校验后读取并锁定对应会话，不信任客户端单独传入的 ID。"""
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        return None
    claims = access_claims(authorization[7:], verify_exp=False)
    if not claims or not claims.get("sid"):
        return None
    item = session.scalar(
        select(AuthSession).where(AuthSession.id == UUID(str(claims["sid"]))).with_for_update()
    )
    return item if item and str(item.user_id) == claims["sub"] else None


def refresh_session(request: Request, response: Response, session: Session) -> str:
    """同时校验访问令牌签名与 Cookie，原子轮换刷新凭据并重新读取用户。"""
    item = session_from_request(request, session)
    token = request.cookies.get(cookie_name(item.id), "") if item else ""
    if (
        not item
        or not active(item)
        or not compare_digest(item.refresh_hash, sha256(token.encode()).hexdigest())
    ):
        raise HTTPException(401, "刷新登录状态已过期，请重新登录")
    user = session.get(User, item.user_id)
    if user is None:
        raise HTTPException(401, "登录状态无效，请重新登录")
    rotate_cookie(item, response)
    session.commit()
    return create_access_token(user, item.id)


def revoke_session(request: Request, response: Response, session: Session) -> None:
    """退出只撤销本次登录，同时使该会话已签发的访问令牌失效。"""
    item = session_from_request(request, session)
    if item:
        item.revoked_at = datetime.now(UTC)
        session.commit()
        settings = get_settings()
        response.delete_cookie(
            cookie_name(item.id),
            path=settings.api_v1_prefix + "/auth",
            secure=settings.environment != "development",
            httponly=True,
            samesite="strict",
        )
    response.headers["Cache-Control"] = "no-store"
