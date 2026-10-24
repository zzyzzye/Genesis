"""隔离数据库与上游传输，验证图片生成、编辑、恢复和私有素材入库。"""

import asyncio
import base64
import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from pydantic import SecretStr
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from genesis_api.api.dependencies import get_current_user
from genesis_api.api.routes import media_image
from genesis_api.api.routes.media import router
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.database.session import get_session
from genesis_api.identity.models import User, UserRole
from genesis_api.media import image, service
from genesis_api.media.models import ImageGeneration, MediaAsset, ProjectAsset

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jbcQAAAAASUVORK5CYII="
)


@dataclass
class ImageFixture:
    """只持有合成测试身份、请求记录及可切换的供应商响应。"""

    client: httpx.AsyncClient
    session: Session
    settings: Settings
    app: FastAPI
    project_id: str = ""
    node_id: str = ""
    requests: list[httpx.Request] = field(default_factory=list)
    status: int = 200
    timeout: bool = False
    cancel: bool = False
    result: dict[str, object] = field(
        default_factory=lambda: {"data": [{"b64_json": base64.b64encode(PNG).decode()}]}
    )


@pytest.fixture
async def fixture(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[ImageFixture]:
    """复用真实路由与模型，不读取真实 Key，不创建付费请求。"""
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    settings = Settings(image_api_key=SecretStr("synthetic-image-test-key"))
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    with Session(engine, expire_on_commit=False) as session:
        user = User(
            id=uuid4(), handle="image-review", display_name="图片测试", role=UserRole.MEMBER
        )
        session.add(user)
        session.commit()
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_session] = lambda: session
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1/media/"
        ) as client:
            state = ImageFixture(client=client, session=session, settings=settings, app=app)

            async def respond(request: httpx.Request) -> httpx.Response:
                await request.aread()
                state.requests.append(request)
                if request.url.path == "/v1/models":
                    return httpx.Response(
                        200, json={"data": [{"id": "gpt-image-2"}, {"id": "new-image-model"}]}
                    )
                if state.timeout:
                    raise httpx.ReadTimeout("测试超时")
                if state.cancel:
                    raise asyncio.CancelledError
                return httpx.Response(state.status, json=state.result)

            real_client = httpx.AsyncClient

            def upstream_client(**kwargs: Any) -> httpx.AsyncClient:
                return real_client(transport=httpx.MockTransport(respond), **kwargs)

            monkeypatch.setattr(service, "STORAGE_ROOT", tmp_path)
            monkeypatch.setattr(media_image, "get_settings", lambda: settings)
            monkeypatch.setattr(image, "SessionLocal", sessionmaker(engine, expire_on_commit=False))
            monkeypatch.setattr(httpx, "AsyncClient", upstream_client)
            state.project_id = (await client.post("projects", json={"name": "图片验收"})).json()[
                "id"
            ]
            state.node_id = str(uuid4())
            await save_node(state)
            yield state
    engine.dispose()


async def save_node(state: ImageFixture, **patch: object) -> None:
    """保存服务端实际节点，测试不能用请求体绕过画布快照。"""
    current = (await state.client.get(f"projects/{state.project_id}/canvas")).json()
    node = {
        "id": state.node_id,
        "type": "image_generation",
        "x": 0,
        "y": 0,
        "width": 640,
        "height": 402,
        "text": "雨夜街道，电影感光影",
        "generation": {"model": "gpt-image-2"},
        **patch,
    }
    result = await state.client.put(
        f"projects/{state.project_id}/canvas",
        json={"version": current["version"], "document": {"nodes": [node]}},
    )
    assert result.status_code == 200


async def submit(
    state: ImageFixture, request_id: UUID | None = None, acknowledge: bool = False
) -> httpx.Response:
    """通过产品入口提交，后台步骤由 ASGI 等待执行，随后单独回读状态。"""
    return await state.client.post(
        f"projects/{state.project_id}/image-generations",
        json={
            "request_id": str(request_id or uuid4()),
            "node_id": state.node_id,
            "acknowledge_unknown": acknowledge,
        },
    )


async def latest(state: ImageFixture) -> dict[str, Any]:
    """刷新任务状态，不再次请求供应商生成。"""
    response = await state.client.get(
        f"projects/{state.project_id}/image-generations?node_id={state.node_id}"
    )
    return dict(response.json()[0])


@pytest.mark.anyio
async def test_models_configuration_and_generation(fixture: ImageFixture) -> None:
    state = fixture
    models = (await state.client.get("image-models")).json()
    assert models["references_ready"] is True
    assert [item["id"] for item in models["models"]] == ["gpt-image-2", "new-image-model"]
    assert models["models"][1]["image_edit"] is False
    request_id = uuid4()
    assert (await submit(state, request_id)).status_code == 202
    task = await latest(state)
    assert task["status"] == "completed"
    assert len(task["asset_ids"]) == 1
    assert "url" not in task and "b64_json" not in task
    post = next(req for req in state.requests if req.method == "POST")
    assert post.headers["idempotency-key"] == str(request_id)
    assert json.loads(post.content) == {
        "model": "gpt-image-2",
        "prompt": "雨夜街道，电影感光影",
        "n": 1,
    }
    assert (await submit(state, request_id)).json() == task
    assert len([req for req in state.requests if req.method == "POST"]) == 1
    asset = state.session.get(MediaAsset, UUID(task["asset_id"]))
    assert asset is not None and asset.kind == "image" and not asset.in_library
    assert state.session.get(ProjectAsset, (UUID(state.project_id), asset.id)) is not None
    assert (service.STORAGE_ROOT / str(asset.id)).read_bytes() == PNG
    assert not image.result_cache(request_id).exists()
    assert (await state.client.get(f"assets/{asset.id}/file")).content == PNG
    state.settings.image_api_key = None
    assert (await state.client.get("image-models")).json()["configured"] is False
    assert (await submit(state)).status_code == 503


@pytest.mark.anyio
async def test_multi_image_and_explicit_size(fixture: ImageFixture) -> None:
    state = fixture
    state.result = {"data": [{"b64_json": base64.b64encode(PNG).decode()}] * 4}
    await save_node(
        state,
        generation={
            "model": "new-image-model",
            "image_size": "1536x1024",
            "count": 4,
            "image_quality": "standard",
            "image_background": "transparent",
        },
    )
    assert (await submit(state)).status_code == 202
    task = await latest(state)
    assert len(task["asset_ids"]) == 4
    assert len(set(task["asset_ids"])) == 4
    payload = json.loads(next(req for req in state.requests if req.method == "POST").content)
    assert payload["size"] == "1536x1024" and payload["n"] == 4
    assert payload["quality"] == "standard" and payload["background"] == "transparent"
    assert "resolution" not in payload and "aspect_ratio" not in payload


@pytest.mark.anyio
async def test_image_edit_uses_local_multipart_without_public_base(fixture: ImageFixture) -> None:
    state = fixture
    asset = (
        await state.client.post(
            f"projects/{state.project_id}/assets",
            files={"file": ("reference.png", PNG, "image/png")},
        )
    ).json()
    await save_node(
        state,
        generation={
            "model": "gpt-image-2",
            "mode": "reference",
            "image_quality": "high",
            "image_background": "opaque",
        },
    )
    current = (await state.client.get(f"projects/{state.project_id}/canvas")).json()
    node_id = str(uuid4())
    current["document"]["nodes"].append(
        {
            "id": node_id,
            "type": "image",
            "asset_id": asset["id"],
            "x": -400,
            "y": 0,
            "width": 360,
            "height": 280,
        }
    )
    current["document"]["edges"] = [
        {"id": str(uuid4()), "source": node_id, "target": state.node_id}
    ]
    assert (
        await state.client.put(f"projects/{state.project_id}/canvas", json=current)
    ).status_code == 200
    assert not state.settings.video_public_base_url
    assert (await submit(state)).status_code == 202
    post = next(req for req in state.requests if req.method == "POST")
    assert post.url.path == "/v1/images/edits"
    assert post.headers["content-type"].startswith("multipart/form-data;")
    assert b'name="image"' in post.content and PNG in post.content
    assert b'name="quality"\r\n\r\nhigh' in post.content
    assert b'name="background"\r\n\r\nopaque' in post.content
    assert b"image_urls" not in post.content
    assert (await latest(state))["status"] == "completed"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "patch",
    [
        {"text": ""},
        {"generation": {"model": "missing-model"}},
        {"generation": {"model": "gpt-image-2", "mode": "reference"}},
        {"generation": {"model": "new-image-model", "mode": "reference"}},
        {"generation": {"model": "gpt-image-2", "mode": "first_last"}},
    ],
)
async def test_invalid_input_never_generates(
    fixture: ImageFixture, patch: dict[str, object]
) -> None:
    await save_node(fixture, **patch)
    assert (await submit(fixture)).status_code == 422
    assert not any(req.method == "POST" for req in fixture.requests)


@pytest.mark.anyio
@pytest.mark.parametrize("status", [400, 401, 402, 429])
async def test_provider_rejection(fixture: ImageFixture, status: int) -> None:
    fixture.status = status
    assert (await submit(fixture)).status_code == 202
    assert (await latest(fixture))["status"] == "failed"


@pytest.mark.anyio
async def test_unknown_requires_acknowledgement_and_never_replays(fixture: ImageFixture) -> None:
    state = fixture
    state.timeout = True
    assert (await submit(state)).status_code == 202
    task = await latest(state)
    assert task["status"] == "unknown"
    assert (await submit(state)).status_code == 409
    assert len([req for req in state.requests if req.method == "POST"]) == 1
    state.timeout = False
    assert (await submit(state, acknowledge=True)).status_code == 202
    assert (await latest(state))["status"] == "completed"


@pytest.mark.anyio
async def test_url_result_retry_only_saves_and_cleans_project(
    fixture: ImageFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    state = fixture
    state.result = {"data": [{"url": "https://media.example.test/result.png"}]}

    async def unavailable(url: str) -> bytes:
        raise httpx.ConnectError("测试下载失败")

    monkeypatch.setattr(image, "public_image", unavailable)
    assert (await submit(state)).status_code == 202
    task = await latest(state)
    assert task["status"] == "download_failed"

    async def available(url: str) -> bytes:
        return PNG

    monkeypatch.setattr(image, "public_image", available)
    assert (
        await state.client.post(
            f"projects/{state.project_id}/image-generations/{task['id']}/retry-download"
        )
    ).status_code == 200
    task = await latest(state)
    assert task["status"] == "completed"
    assert len([req for req in state.requests if req.method == "POST"]) == 1
    path = service.STORAGE_ROOT / task["asset_id"]
    assert (await state.client.delete(f"projects/{state.project_id}")).status_code == 204
    assert not path.exists()


@pytest.mark.anyio
async def test_cancelled_submit_is_unknown_not_replayed(fixture: ImageFixture) -> None:
    """进程取消不丢失付费提交记录，也不将未知结果误标为可自动重试。"""
    fixture.cancel = True
    with pytest.raises(asyncio.CancelledError):
        await submit(fixture)
    assert (await latest(fixture))["status"] == "unknown"
    assert (await submit(fixture)).status_code == 409
    assert len([req for req in fixture.requests if req.method == "POST"]) == 1


@pytest.mark.anyio
@pytest.mark.parametrize("result", [{"data": []}, {"data": [{"unexpected": "invalid"}]}])
async def test_malformed_success_remains_unknown(
    fixture: ImageFixture, result: dict[str, object]
) -> None:
    fixture.result = result
    assert (await submit(fixture)).status_code == 202
    assert (await latest(fixture))["status"] == "unknown"


@pytest.mark.anyio
async def test_partial_results_roll_back_and_preserve_cache(fixture: ImageFixture) -> None:
    state = fixture
    state.result = {
        "data": [{"b64_json": base64.b64encode(PNG).decode()}, {"b64_json": "not-base64"}]
    }
    assert (await submit(state)).status_code == 202
    task = await latest(state)
    assert task["status"] == "download_failed"
    assert not state.session.scalars(select(MediaAsset)).all()
    assert image.result_cache(UUID(task["id"])).exists()
    assert list(service.STORAGE_ROOT.iterdir()) == [image.result_cache(UUID(task["id"]))]


@pytest.mark.anyio
async def test_recover_cached_response_and_stale_request(
    fixture: ImageFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    state = fixture
    owner_id = state.session.scalar(select(User.id))
    assert owner_id is not None
    task = ImageGeneration(
        id=uuid4(),
        owner_id=owner_id,
        project_id=UUID(state.project_id),
        node_id=UUID(state.node_id),
        snapshot={},
        status="processing",
        created_at=datetime.now(UTC) - timedelta(minutes=18),
    )
    state.session.add(task)
    state.session.commit()

    async def stop(_: float) -> None:
        raise asyncio.CancelledError

    monkeypatch.setattr(asyncio, "sleep", stop)
    with pytest.raises(asyncio.CancelledError):
        await image.recover_images()
    state.session.refresh(task)
    assert task.status == "unknown"
    image.result_cache(task.id).write_text(
        json.dumps([{"b64_json": base64.b64encode(PNG).decode()}])
    )
    task.status = "processing"
    state.session.commit()
    with pytest.raises(asyncio.CancelledError):
        await image.recover_images()
    state.session.refresh(task)
    assert task.status == "completed"
    assert not any(req.method == "POST" for req in state.requests)


@pytest.mark.anyio
async def test_cross_account_and_active_delete(fixture: ImageFixture) -> None:
    state = fixture
    owner_id = state.session.scalar(select(User.id))
    task = ImageGeneration(
        id=uuid4(),
        owner_id=owner_id,
        project_id=UUID(state.project_id),
        node_id=UUID(state.node_id),
        snapshot={},
        status="processing",
    )
    state.session.add(task)
    state.session.commit()
    assert (await state.client.delete(f"projects/{state.project_id}")).status_code == 409
    assert (await submit(state)).status_code == 409
    other = User(id=uuid4(), handle="other-image", display_name="其他用户", role=UserRole.MEMBER)
    state.session.add(other)
    state.session.commit()
    state.app.dependency_overrides[get_current_user] = lambda: other
    assert (
        await state.client.get(
            f"projects/{state.project_id}/image-generations?node_id={state.node_id}"
        )
    ).status_code == 404
    assert (await submit(state)).status_code == 404


@pytest.mark.anyio
@pytest.mark.parametrize(
    "url",
    [
        "http://media.example.test/a.png",
        "https://127.0.0.1/a.png",
        "https://[::1]/a.png",
        "https://user:pass@media.example.test/a.png",
    ],
)
async def test_result_url_rejects_private_or_authenticated_addresses(url: str) -> None:
    with pytest.raises(ValueError):
        await image.public_image(url)


@pytest.mark.anyio
async def test_public_download_pins_dns_checks_redirects_and_omits_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """每跳固定公网 IP，SNI/Host 保留真实域名，不传服务商 Bearer。"""
    requests: list[httpx.Request] = []
    private_redirect = False

    async def dns(host: str, *args: Any, **kwargs: Any) -> list[Any]:
        return [(2, 1, 6, "", ("127.0.0.1" if host == "127.0.0.1" else "8.8.8.8", 443))]

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.url.host == "8.8.8.8"
        assert request.headers.get("authorization") is None
        assert request.extensions["sni_hostname"] == request.headers["host"]
        if request.headers["host"] == "images.example.test":
            return httpx.Response(
                302,
                headers={
                    "Location": "https://127.0.0.1/a.png"
                    if private_redirect
                    else "https://cdn.example.test/a.png"
                },
            )
        return httpx.Response(200, headers={"Content-Type": "image/png"}, content=PNG)

    real_client = httpx.AsyncClient
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", dns)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs),
    )
    assert await image.public_image("https://images.example.test/result.png") == PNG
    assert len(requests) == 2
    private_redirect = True
    with pytest.raises(ValueError):
        await image.public_image("https://images.example.test/result.png")
