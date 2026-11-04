"""为原生播放器签发单素材 Cookie，保留私有鉴权和 Range 分段传输。"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from genesis_api.api.dependencies import (
    CurrentUserDependency,
    SessionDependency,
    TokenDependency,
)
from genesis_api.core.config import get_settings
from genesis_api.core.uploads import media_filename
from genesis_api.identity.models import AuthSession, User
from genesis_api.identity.sessions import active
from genesis_api.identity.tokens import access_claims
from genesis_api.media import service

router = APIRouter()
COOKIE = "genesis_media"
LIFETIME = 3600


@router.post("/assets/{asset_id}/playback", status_code=204)
def authorize_playback(
    asset_id: UUID,
    response: Response,
    user: CurrentUserDependency,
    session: SessionDependency,
    token: TokenDependency,
) -> None:
    """登录校验后授权单个音视频，Cookie 不暴露给脚本、URL 或访问日志。

    授权一小时有效，并绑定原登录会话；退出后后续分段读取立即失效。
    过期后客户端通过同一接口重新授权，不重放生成请求。
    """
    asset = service.asset_for(session, user.id, asset_id)
    if asset.kind not in {"video", "audio"}:
        raise HTTPException(422, "该素材不支持音视频播放")
    if not (service.STORAGE_ROOT / str(asset.id)).is_file():
        raise HTTPException(404, "素材文件不可用")
    claims = access_claims(token)
    if claims is None or claims["sub"] != str(user.id):
        raise HTTPException(401, "登录状态无效或已过期")
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user.id),
        "asset": str(asset.id),
        "aud": "media-playback",
        "exp": min(int((now + timedelta(seconds=LIFETIME)).timestamp()), int(str(claims["exp"]))),
    }
    if claims.get("sid"):
        payload["sid"] = claims["sid"]
    response.set_cookie(
        COOKIE,
        jwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm="HS256"),
        max_age=LIFETIME,
        path=f"{settings.api_v1_prefix}/media/assets/{asset_id}/stream",
        httponly=True,
        secure=settings.environment != "development",
        samesite="strict",
    )
    response.headers["Cache-Control"] = "no-store"


@router.get("/assets/{asset_id}/stream")
@router.head("/assets/{asset_id}/stream")
def stream_asset(
    asset_id: UUID, request: Request, session: SessionDependency, download: bool = False
) -> FileResponse:
    """逐次检查授权范围、会话与素材归属，使用 FileResponse 原生 Range 支持。"""
    try:
        claims = jwt.decode(
            request.cookies.get(COOKIE, ""),
            get_settings().jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            audience="media-playback",
            options={"require": ["sub", "asset", "aud", "exp"]},
        )
        user_id = UUID(claims["sub"])
        if claims["asset"] != str(asset_id):
            raise ValueError
        if claims.get("sid"):
            login = session.get(AuthSession, UUID(claims["sid"]))
            if login is None or login.user_id != user_id or not active(login):
                raise ValueError
        if session.get(User, user_id) is None:
            raise ValueError
    except (jwt.PyJWTError, ValueError, TypeError, KeyError) as exc:
        raise HTTPException(401, "播放授权已过期，请重试加载素材") from exc
    asset = service.asset_for(session, user_id, asset_id)
    path = service.STORAGE_ROOT / str(asset.id)
    if not path.is_file():
        raise HTTPException(404, "素材文件不可用")
    return FileResponse(
        path,
        media_type=asset.mime_type,
        filename=media_filename(asset.name, asset.mime_type),
        content_disposition_type="attachment" if download else "inline",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )
