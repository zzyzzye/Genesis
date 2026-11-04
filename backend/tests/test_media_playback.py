"""私有分段播放只接受单素材授权，覆盖越权、过期、退出和 HTTP Range。"""

from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import jwt
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from genesis_api.api.routes.media import router
from genesis_api.core.config import get_settings
from genesis_api.database.base import Base
from genesis_api.database.session import get_session
from genesis_api.identity.models import AuthSession, User, UserRole
from genesis_api.identity.tokens import create_access_token
from genesis_api.media import service
from genesis_api.media.models import MediaAsset


@pytest.fixture
async def playback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncGenerator[tuple[AsyncClient, Session, MediaAsset, AuthSession], None]:
    """仅使用隔离合成用户与文件，不读取现有账户或真实素材。"""
    monkeypatch.setattr(service, "STORAGE_ROOT", tmp_path)
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    with Session(engine, autoflush=False) as session:
        user = User(
            id=uuid4(), handle="playback-test", display_name="播放测试", role=UserRole.MEMBER
        )
        login = AuthSession(
            id=uuid4(),
            user_id=user.id,
            refresh_hash="synthetic",
            expires_at=datetime.now(UTC) + timedelta(hours=2),
        )
        asset = MediaAsset(
            id=uuid4(),
            owner_id=user.id,
            name="片段",
            kind="video",
            mime_type="video/mp4",
            size=10,
            in_library=True,
        )
        session.add_all([user, login, asset])
        session.commit()
        (tmp_path / str(asset.id)).write_bytes(b"0123456789")
        app.dependency_overrides[get_session] = lambda: session
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="https://test/api/v1/media/",
            headers={"Authorization": f"Bearer {create_access_token(user, login.id)}"},
        ) as client:
            yield client, session, asset, login
    engine.dispose()


@pytest.mark.anyio
async def test_playback_range_and_download(
    playback: tuple[AsyncClient, Session, MediaAsset, AuthSession],
) -> None:
    client, _, asset, _ = playback
    path = f"assets/{asset.id}"
    assert (await client.get(f"{path}/stream")).status_code == 401
    result = await client.post(f"{path}/playback")
    assert result.status_code == 204 and not result.content
    cookie = result.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie
    assert f"Path=/api/v1/media/{path}/stream" in cookie
    partial = await client.get(f"{path}/stream", headers={"Range": "bytes=2-5"})
    assert partial.status_code == 206 and partial.content == b"2345"
    assert partial.headers["content-range"] == "bytes 2-5/10"
    assert partial.headers["content-disposition"].startswith("inline")
    assert partial.headers["cache-control"] == "private, no-store"
    assert (await client.head(f"{path}/stream")).headers["content-length"] == "10"
    assert (await client.get(f"{path}/stream", headers={"Range": "bytes=20-"})).status_code == 416
    assert (
        (await client.get(f"{path}/stream?download=true"))
        .headers["content-disposition"]
        .startswith("attachment")
    )


@pytest.mark.anyio
async def test_playback_rejects_cross_asset_and_revoked_session(
    playback: tuple[AsyncClient, Session, MediaAsset, AuthSession],
) -> None:
    client, session, asset, login = playback
    await client.post(f"assets/{asset.id}/playback")
    # 即使主动把 Cookie 复制到另一素材 URL，签名中的 asset 范围仍会拒绝。
    cookie = client.cookies.get("genesis_media")
    assert (
        await client.get(f"assets/{uuid4()}/stream", headers={"Cookie": f"genesis_media={cookie}"})
    ).status_code == 401
    login.revoked_at = datetime.now(UTC)
    session.commit()
    assert (await client.get(f"assets/{asset.id}/stream")).status_code == 401
    assert (await client.post(f"assets/{asset.id}/playback")).status_code == 401


@pytest.mark.anyio
async def test_playback_rechecks_owner_and_expiry(
    playback: tuple[AsyncClient, Session, MediaAsset, AuthSession],
) -> None:
    client, session, asset, login = playback
    await client.post(f"assets/{asset.id}/playback")
    expired = jwt.encode(
        {"sub": str(login.user_id), "asset": str(asset.id), "aud": "media-playback", "exp": 1},
        get_settings().jwt_secret.get_secret_value(),
        algorithm="HS256",
    )
    assert (
        await client.get(
            f"assets/{asset.id}/stream", headers={"Cookie": f"genesis_media={expired}"}
        )
    ).status_code == 401
    asset.owner_id = uuid4()
    session.commit()
    assert (await client.get(f"assets/{asset.id}/stream")).status_code == 404
    assert (await client.post(f"assets/{asset.id}/playback")).status_code == 404
