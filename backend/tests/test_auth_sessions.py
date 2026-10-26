"""验证一天访问令牌、刷新轮换、会话隔离与退出撤销。"""

from collections.abc import AsyncGenerator, Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from jwt import decode, encode
from pydantic import SecretStr
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from genesis_api.core import config
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.database.session import get_session
from genesis_api.identity import avatars, sessions, tokens
from genesis_api.identity.models import AuthSession, User, UserCredential, UserRole
from genesis_api.identity.passwords import hash_password
from genesis_api.main import app


@pytest.fixture
async def state(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[tuple[AsyncClient, Session, Settings]]:
    """只使用隔离数据库与合成凭据，不访问真实账户或配置文件。"""
    settings = Settings(
        _env_file=None,
        environment="development",
        jwt_secret=SecretStr("synthetic-session-test-signing-key"),
        jwt_access_token_expire_minutes=1440,
        jwt_refresh_token_expire_minutes=1440,
    )
    for module in (config, sessions, tokens):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    engine = create_engine(
        "sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        session.add(
            User(
                handle="genesis",
                display_name="测试账户",
                role=UserRole.MEMBER,
                credential=UserCredential(password_hash=hash_password("synthetic-login-password")),
            )
        )
        session.commit()

        def dependency() -> Generator[Session, None, None]:
            yield session

        app.dependency_overrides[get_session] = dependency
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                yield client, session, settings
        finally:
            app.dependency_overrides.clear()
    engine.dispose()


async def login(client: AsyncClient) -> str:
    """在测试应用登录，令牌仅用于内部协议验证。"""
    response = await client.post(
        "/api/v1/auth/login",
        data={
            "username": "genesis",
            "password": "synthetic-login-password",
        },
    )
    assert response.status_code == 200
    return str(response.json()["access_token"])


@pytest.mark.anyio
async def test_avatar_upload_and_public_read(
    state: tuple[AsyncClient, Session, Settings], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """保存头像和资料，按实际内容定后缀，替换后旧地址不再公开。"""
    client, _, _ = state
    monkeypatch.setattr(avatars, "STORAGE_ROOT", tmp_path)
    token = await login(client)
    image = b"\x89PNG\r\n\x1a\n" + b"synthetic-image"
    result = await client.put(
        "/api/v1/auth/me/avatar",
        headers=auth(token),
        files={"file": ("../portrait.jpg", image, "image/jpeg")},
        data={"display_name": " 新昵称 ", "bio": " 简介 "},
    )
    assert result.status_code == 200
    user = result.json()
    assert user["display_name"] == "新昵称" and user["bio"] == "简介"
    url = user["avatar_url"]
    assert url.endswith(".png") and "portrait" not in url
    public = await client.get(url)
    assert public.status_code == 200 and public.content == image
    assert public.headers["content-type"] == "image/png"
    assert public.headers["x-content-type-options"] == "nosniff"
    assert (await client.get(url.replace(".png", ".jpg"))).status_code == 404
    response = await client.put(
        "/api/v1/auth/me",
        headers=auth(token),
        json={"display_name": "新昵称", "bio": "简介", "avatar_url": None},
    )
    assert response.status_code == 200
    assert (await client.get(url)).status_code == 404


@pytest.mark.anyio
async def test_avatar_rejects_invalid_oversized_and_unauthenticated_uploads(
    state: tuple[AsyncClient, Session, Settings], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """拒绝主动内容、超限与未登录上传，失败不改变资料或遗留文件。"""
    client, _, _ = state
    monkeypatch.setattr(avatars, "STORAGE_ROOT", tmp_path)
    token = await login(client)
    for content, code in [
        (b"<svg></svg>", 422),
        (b"\x89PNG\r\n\x1a\n" + b"x" * (5 * 1024 * 1024), 413),
    ]:
        result = await client.put(
            "/api/v1/auth/me/avatar",
            headers=auth(token),
            files={"file": ("image.png", content, "image/png")},
            data={"display_name": "不应保存"},
        )
        assert result.status_code == code
    assert list(tmp_path.iterdir()) == []
    profile = (await client.get("/api/v1/auth/me", headers=auth(token))).json()
    assert profile["display_name"] == "测试账户"
    anonymous = await client.put(
        "/api/v1/auth/me/avatar",
        files={"file": ("image.png", b"x")},
        data={"display_name": "不应保存"},
    )
    assert anonymous.status_code == 401


@pytest.mark.anyio
async def test_avatar_database_failure_removes_new_file(
    state: tuple[AsyncClient, Session, Settings], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """资料提交失败时回滚用户字段并删除本次上传，允许使用原资料重试。"""
    client, session, _ = state
    monkeypatch.setattr(avatars, "STORAGE_ROOT", tmp_path)
    token = await login(client)

    def fail_commit() -> None:
        raise HTTPException(503, "测试数据库暂不可用")

    with monkeypatch.context() as scoped:
        scoped.setattr(session, "commit", fail_commit)
        result = await client.put(
            "/api/v1/auth/me/avatar",
            headers=auth(token),
            files={"file": ("image.png", b"\x89PNG\r\n\x1a\ncontent", "image/png")},
            data={"display_name": "不应保存"},
        )
    assert result.status_code == 503 and list(tmp_path.iterdir()) == []
    profile = (await client.get("/api/v1/auth/me", headers=auth(token))).json()
    assert profile["display_name"] == "测试账户" and profile["avatar_url"] is None


def auth(token: str) -> dict[str, str]:
    """构造测试请求头，不输出任何凭据。"""
    return {"Authorization": f"Bearer {token}"}


def payload(token: str, settings: Settings) -> dict[str, object]:
    """用合成签名验证测试令牌的时限与会话绑定。"""
    return dict(decode(token, settings.jwt_secret.get_secret_value(), algorithms=["HS256"]))


@pytest.mark.anyio
async def test_login_day_and_http_only_cookie(state: tuple[AsyncClient, Session, Settings]) -> None:
    client, session, settings = state
    assert Settings(_env_file=None).jwt_access_token_expire_minutes == 1440
    bad = await client.post("/api/v1/auth/login", data={"username": "genesis", "password": "wrong"})
    assert bad.status_code == 401 and "set-cookie" not in bad.headers
    token = await login(client)
    claims = payload(token, settings)
    assert int(str(claims["exp"])) - int(str(claims["iat"])) == 86400
    item = session.get(AuthSession, UUID(str(claims["sid"])))
    assert item is not None and sessions.active(item)
    cookie = client.cookies.get(sessions.cookie_name(item.id))
    assert cookie and item.refresh_hash != cookie and len(item.refresh_hash) == 64
    assert (await client.get("/api/v1/auth/me", headers=auth(token))).status_code == 200


@pytest.mark.anyio
async def test_rotation_and_cookie_binding(state: tuple[AsyncClient, Session, Settings]) -> None:
    client, session, settings = state
    token = await login(client)
    claims = payload(token, settings)
    sid = UUID(str(claims["sid"]))
    name = sessions.cookie_name(sid)
    previous = client.cookies.get(name)
    item = session.get(AuthSession, sid)
    assert item is not None
    user = session.get(User, item.user_id)
    assert user is not None
    user.role = UserRole.OWNER
    session.commit()
    response = await client.post("/api/v1/auth/refresh", headers=auth(token))
    assert response.status_code == 200
    assert set(response.json()) == {"access_token", "token_type"}
    assert response.headers["cache-control"] == "no-store"
    cookie_header = response.headers["set-cookie"].lower()
    assert "httponly" in cookie_header and "samesite=strict" in cookie_header
    assert "max-age=86400" in cookie_header and "path=/api/v1/auth" in cookie_header
    assert client.cookies.get(name) != previous
    fresh = payload(response.json()["access_token"], settings)
    assert fresh["role"] == "owner" and fresh["sid"] == claims["sid"]
    assert int(str(fresh["exp"])) - int(str(fresh["iat"])) == 86400
    replay = await client.post(
        "/api/v1/auth/refresh", headers={**auth(token), "Cookie": f"{name}={previous}"}
    )
    assert replay.status_code == 401
    other = await login(client)
    bound = await client.post(
        "/api/v1/auth/refresh",
        headers={**auth(other), "Cookie": f"{name}={client.cookies.get(name)}"},
    )
    assert bound.status_code == 401


@pytest.mark.anyio
async def test_expiry_and_logout_are_enforced(state: tuple[AsyncClient, Session, Settings]) -> None:
    client, session, settings = state
    token = await login(client)
    sid = UUID(str(payload(token, settings)["sid"]))
    item = session.get(AuthSession, sid)
    assert item is not None
    item.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    session.commit()
    assert (await client.get("/api/v1/auth/me", headers=auth(token))).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", headers=auth(token))).status_code == 401
    first = await login(client)
    second = await login(client)
    assert (await client.post("/api/v1/auth/logout", headers=auth(first))).status_code == 204
    assert (await client.post("/api/v1/auth/logout", headers=auth(first))).status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=auth(first))).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", headers=auth(first))).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=auth(second))).status_code == 200


@pytest.mark.anyio
async def test_refresh_proof_and_expired_access(
    state: tuple[AsyncClient, Session, Settings],
) -> None:
    client, session, settings = state
    token = await login(client)
    claims = payload(token, settings)
    no_cookie = await client.post("/api/v1/auth/refresh", headers={**auth(token), "Cookie": ""})
    assert no_cookie.status_code == 401
    assert (await client.post("/api/v1/auth/refresh")).status_code == 401
    claims["exp"] = int(datetime.now(UTC).timestamp()) - 1
    expired = encode(claims, settings.jwt_secret.get_secret_value(), algorithm="HS256")
    assert (await client.get("/api/v1/auth/me", headers=auth(expired))).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", headers=auth(expired))).status_code == 200
    claims["exp"] = int(datetime.now(UTC).timestamp()) + 100
    claims["type"] = "refresh"
    wrong_type = encode(claims, settings.jwt_secret.get_secret_value(), algorithm="HS256")
    assert (await client.get("/api/v1/auth/me", headers=auth(wrong_type))).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", headers=auth(wrong_type))).status_code == 401
    user = session.scalar(select(User))
    assert user is not None
    legacy = tokens.create_access_token(user)
    assert (await client.get("/api/v1/auth/me", headers=auth(legacy))).status_code == 200
    assert (await client.post("/api/v1/auth/refresh", headers=auth(legacy))).status_code == 401


@pytest.mark.anyio
async def test_dev_login_and_production_cookie(
    state: tuple[AsyncClient, Session, Settings],
) -> None:
    client, session, settings = state
    user = session.scalar(select(User))
    assert user is not None
    user.role = UserRole.OWNER
    session.commit()
    assert (await client.post("/api/v1/auth/dev-login")).status_code == 200
    settings.environment = "production"
    assert (await client.post("/api/v1/auth/dev-login")).status_code == 404
    response = await client.post(
        "/api/v1/auth/login",
        data={
            "username": "genesis",
            "password": "synthetic-login-password",
        },
    )
    assert "secure" in response.headers["set-cookie"].lower()
