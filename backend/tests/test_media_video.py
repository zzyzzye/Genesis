"""用隔离数据库和供应商响应验证视频协议，不创建真实付费任务。"""

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
import jwt
import pytest
from fastapi import FastAPI, HTTPException
from pydantic import SecretStr
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from genesis_api.api.dependencies import get_current_user
from genesis_api.api.routes import media_video
from genesis_api.api.routes.media import router
from genesis_api.core.access_logging import MediaReferenceLogFilter
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.database.session import get_session
from genesis_api.identity.models import User, UserRole
from genesis_api.media import service, video
from genesis_api.media.models import MediaAsset, VideoGeneration
from genesis_api.media.video_catalog import CATALOG


@dataclass
class VideoFixture:
    """测试持有的数据库、身份与可变上游响应，不读取真实凭据。"""

    client: httpx.AsyncClient
    session: Session
    settings: Settings
    app: FastAPI
    project_id: str = ""
    node_id: str = ""
    requests: list[httpx.Request] = field(default_factory=list)
    create_code: int = 200
    timeout: bool = False
    status: str = "processing"
    mime: str = "video/mp4"
    content: bytes = b"test-video-content"
    reference_ok: bool = True


@pytest.fixture
async def fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[VideoFixture]:
    """复用实际路由，所有外部请求交给 MockTransport。"""
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    settings = Settings(
        video_api_key=SecretStr("synthetic-video-key"),
        video_public_base_url="https://serenova.cn",
        agent_action_secret=SecretStr("test-video-reference-signing-key-only"),
    )
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    with Session(engine, expire_on_commit=False) as session:
        user = User(id=uuid4(), handle="video-test", display_name="视频验收", role=UserRole.MEMBER)
        session.add(user)
        session.commit()
        app.dependency_overrides[get_session] = lambda: session
        app.dependency_overrides[get_current_user] = lambda: user
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1/media/"
        ) as client:
            state = VideoFixture(client, session, settings, app)

            def respond(request: httpx.Request) -> httpx.Response:
                state.requests.append(request)
                if request.url.host == "serenova.cn":
                    assert request.headers.get("Authorization") is None
                    return httpx.Response(
                        200,
                        headers={
                            "Content-Type": "image/png" if state.reference_ok else "text/html"
                        },
                        content=b"reference",
                    )
                if request.url.path == "/v1/models":
                    return httpx.Response(
                        200,
                        json={
                            "data": [
                                {"id": item}
                                for item in (
                                    "grok-imagine-video",
                                    "seedance-2.0-720p",
                                    "minimax-h3-首尾帧",
                                    "unverified-model",
                                )
                            ]
                        },
                    )
                if request.method == "POST":
                    if state.timeout:
                        raise httpx.ReadTimeout("测试超时")
                    return httpx.Response(
                        state.create_code, json={"task_id": "task_public", "id": "internal-id"}
                    )
                if request.url.host == "media.yyapi.cloud":
                    return httpx.Response(
                        200, headers={"Content-Type": state.mime}, content=state.content
                    )
                return httpx.Response(
                    200,
                    json={
                        "id": "must-not-replace-public-id",
                        "status": state.status,
                        "progress": 42,
                    },
                )

            real_client = httpx.AsyncClient

            def upstream_client(**kwargs: Any) -> httpx.AsyncClient:
                return real_client(transport=httpx.MockTransport(respond), **kwargs)

            monkeypatch.setattr(service, "STORAGE_ROOT", tmp_path)
            monkeypatch.setattr(media_video, "get_settings", lambda: settings)
            monkeypatch.setattr(video, "get_settings", lambda: settings)
            monkeypatch.setattr(video, "_catalog_cache", (0, "", []))
            monkeypatch.setattr(video, "SessionLocal", sessionmaker(engine, expire_on_commit=False))
            monkeypatch.setattr(httpx, "AsyncClient", upstream_client)
            project = await client.post("projects", json={"name": "视频测试"})
            state.project_id = project.json()["id"]
            state.node_id = str(uuid4())
            await save_node(state)
            yield state
    engine.dispose()


async def save_node(state: VideoFixture, **patch: object) -> None:
    """保存实际画布，提交始终读取这一份服务端快照。"""
    node: dict[str, object] = {
        "id": state.node_id,
        "type": "video",
        "x": 0,
        "y": 0,
        "width": 640,
        "height": 402,
        "text": "雨夜街道，路灯倒映在积水中。",
        "duration_seconds": 5,
        "generation": {"model": "grok-imagine-video", "ratio": "16:9", "resolution": "720P"},
        **patch,
    }
    snapshot = (await state.client.get(f"projects/{state.project_id}/canvas")).json()
    result = await state.client.put(
        f"projects/{state.project_id}/canvas",
        json={
            "version": snapshot["version"],
            "document": {"nodes": [node]},
        },
    )
    assert result.status_code == 200


async def submit(
    state: VideoFixture, request_id: UUID | None = None, acknowledge: bool = False
) -> httpx.Response:
    """仅通过产品提交入口创建测试任务。"""
    response = await state.client.post(
        f"projects/{state.project_id}/video-generations",
        json={
            "request_id": str(request_id or uuid4()),
            "node_id": state.node_id,
            "acknowledge_unknown": acknowledge,
        },
    )
    if response.status_code == 202:
        # ASGITransport 会等待响应后的后台提交；回读持久记录验证其最终提交状态。
        task = state.session.get(VideoGeneration, UUID(response.json()["id"]))
        assert task is not None
        state.session.refresh(task)
        return httpx.Response(202, json=video.task_data(task), request=response.request)
    return response


@pytest.mark.anyio
async def test_live_catalog_and_missing_configuration(fixture: VideoFixture) -> None:
    state = fixture
    response = (await state.client.get("video-models")).json()
    assert response["configured"] is True
    assert len(CATALOG) == 45
    assert [item["id"] for item in response["models"]] == [
        "grok-imagine-video",
        "seedance-2.0-720p",
        "minimax-h3-首尾帧",
        "unverified-model",
    ]
    assert response["models"][-1]["parameters_known"] is False
    assert response["models"][-1]["durations"] == []
    await state.client.get("video-models")
    assert len(state.requests) == 1
    state.settings.video_api_key = None
    assert (await state.client.get("video-models")).json()["configured"] is False
    assert (await submit(state)).status_code == 503


@pytest.mark.anyio
async def test_new_model_uses_provider_defaults(fixture: VideoFixture) -> None:
    """新目录模型可提交文生视频，但不猜测可选参数和参考能力。"""
    state = fixture
    await save_node(state, generation={"model": "unverified-model", "mode": "text"})
    assert (await submit(state)).status_code == 202
    payload = next(request for request in state.requests if request.method == "POST")
    assert json.loads(payload.content) == {
        "model": "unverified-model",
        "prompt": "雨夜街道，路灯倒映在积水中。",
    }


@pytest.mark.anyio
async def test_submit_is_idempotent_and_recovers_after_reload(fixture: VideoFixture) -> None:
    state = fixture
    request_id = uuid4()
    created = await submit(state, request_id)
    assert created.status_code == 202
    assert created.json()["status"] == "queued"
    assert (await submit(state, request_id)).json() == created.json()
    assert (await submit(state)).status_code == 409
    posts = [request for request in state.requests if request.method == "POST"]
    assert len(posts) == 1
    payload = json.loads(posts[0].content)
    assert payload["duration"] == 5
    assert payload["resolution"] == "720p"
    assert payload["aspect_ratio"] == "16:9"
    assert "image_urls" not in payload
    task = state.session.get(VideoGeneration, request_id)
    assert task is not None and task.upstream_id == "task_public"
    restored = await state.client.get(
        f"projects/{state.project_id}/video-generations?node_id={state.node_id}"
    )
    assert restored.json()[0]["id"] == str(request_id)
    await video.refresh_task(task, state.session, state.settings)
    assert task.upstream_id == "task_public"
    assert task.status == "processing" and task.progress == 42


@pytest.mark.anyio
@pytest.mark.parametrize(
    "patch",
    [
        {"text": ""},
        {"duration_seconds": 60},
        {"generation": {"model": "not-in-live-catalog"}},
        {"generation": {"model": "unverified-model", "mode": "reference"}},
        {"generation": {"model": "grok-imagine-video", "resolution": "2K"}},
        {"generation": {"model": "grok-imagine-video", "ratio": "1:1"}},
        {"generation": {"model": "grok-imagine-video", "count": 2}},
        {"generation": {"model": "grok-imagine-video", "mode": "reference"}},
    ],
)
async def test_invalid_parameters_never_create_upstream_task(
    fixture: VideoFixture,
    patch: dict[str, object],
) -> None:
    await save_node(fixture, **patch)
    assert (await submit(fixture)).status_code == 422
    assert not any(request.method == "POST" for request in fixture.requests)


@pytest.mark.anyio
async def test_unknown_create_never_retries_without_acknowledgement(fixture: VideoFixture) -> None:
    state = fixture
    state.timeout = True
    request_id = uuid4()
    assert (await submit(state, request_id)).json()["status"] == "unknown"
    assert (await submit(state, request_id)).json()["status"] == "unknown"
    assert (await submit(state)).status_code == 409
    assert len([r for r in state.requests if r.method == "POST"]) == 1
    state.timeout = False
    assert (await submit(state, acknowledge=True)).json()["status"] == "queued"
    assert len([r for r in state.requests if r.method == "POST"]) == 2


@pytest.mark.anyio
@pytest.mark.parametrize("status", ["failed", "cancelled", "pending", "in_progress"])
async def test_poll_terminal_and_running_states(fixture: VideoFixture, status: str) -> None:
    state = fixture
    created = (await submit(state)).json()
    task = state.session.get(VideoGeneration, UUID(created["id"]))
    assert task is not None
    state.status = status
    await video.refresh_task(task, state.session, state.settings)
    assert (
        task.status
        == {
            "failed": "failed",
            "cancelled": "failed",
            "pending": "queued",
            "in_progress": "processing",
        }[status]
    )


@pytest.mark.anyio
async def test_completed_video_is_private_asset_and_invalid_download_cleans_up(
    fixture: VideoFixture,
) -> None:
    state = fixture
    task_id = (await submit(state)).json()["id"]
    task = state.session.get(VideoGeneration, UUID(task_id))
    assert task is not None
    state.status = "completed"
    state.mime = "text/html"
    await video.refresh_task(task, state.session, state.settings)
    assert task.status == "download_failed"
    assert not list(service.STORAGE_ROOT.iterdir())
    retry_url = f"projects/{state.project_id}/video-generations/{task.id}/retry-download"
    assert (await state.client.post(retry_url)).status_code == 200
    state.mime = "video/mp4"
    state.content = b""
    await video.refresh_task(task, state.session, state.settings)
    assert task.status == "download_failed"
    assert (await state.client.post(retry_url)).status_code == 200
    state.content = b"video-result"
    await video.refresh_task(task, state.session, state.settings)
    assert task.status == "completed" and task.asset_id
    asset = state.session.get(MediaAsset, task.asset_id)
    assert asset is not None and asset.in_library is False
    assert (await state.client.get(f"assets/{task.asset_id}/file")).content == b"video-result"
    assert len(state.session.scalars(select(MediaAsset)).all()) == 1
    assert (await state.client.post(retry_url)).status_code == 409
    assert (await state.client.delete(f"projects/{state.project_id}")).status_code == 204
    assert state.session.scalar(select(VideoGeneration.id)) is None


@pytest.mark.anyio
async def test_running_video_prevents_project_deletion(fixture: VideoFixture) -> None:
    state = fixture
    await submit(state)
    response = await state.client.delete(f"projects/{state.project_id}")
    assert response.status_code == 409
    assert "视频任务运行" in response.json()["detail"]


@pytest.mark.anyio
async def test_reference_links_are_task_scoped_and_expiring(fixture: VideoFixture) -> None:
    state = fixture
    image = (
        await state.client.post(
            f"projects/{state.project_id}/assets",
            files={
                "file": ("reference.png", b"reference", "image/png"),
            },
        )
    ).json()
    snapshot = (await state.client.get(f"projects/{state.project_id}/canvas")).json()
    doc = snapshot["document"]
    source_id = str(uuid4())
    doc["nodes"][0]["generation"]["mode"] = "reference"
    doc["nodes"].append(
        {
            "id": source_id,
            "type": "image",
            "asset_id": image["id"],
            "x": 0,
            "y": 0,
            "width": 360,
            "height": 280,
        }
    )
    doc["edges"] = [{"id": str(uuid4()), "source": source_id, "target": state.node_id}]
    await state.client.put(
        f"projects/{state.project_id}/canvas",
        json={
            "version": snapshot["version"],
            "document": doc,
        },
    )
    state.settings.video_public_base_url = ""
    assert (await submit(state)).status_code == 422
    state.settings.video_public_base_url = "https://serenova.cn"
    assert (await submit(state)).status_code == 202
    payload = json.loads(next(r for r in state.requests if r.method == "POST").content)
    parts = urlsplit(payload["image_urls"][0])
    assert parts.netloc == "serenova.cn"
    result = await state.client.get(f"http://test{parts.path}?{parts.query}")
    assert result.status_code == 200 and result.content == b"reference"
    assert result.headers["cache-control"] == "no-store"
    expired = jwt.encode(
        {
            "sub": image["id"],
            "task": "expired",
            "aud": "video-reference",
            "exp": datetime.now(UTC) - timedelta(seconds=1),
        },
        state.settings.agent_action_secret.get_secret_value(),
        algorithm="HS256",
    )
    assert (await state.client.get(f"http://test{parts.path}?token={expired}")).status_code == 404
    assert (await state.client.get(f"http://test{parts.path}?token=invalid")).status_code == 404
    assert (
        await state.client.get(
            f"http://test{parts.path.replace(image['id'], str(uuid4()))}?{parts.query}"
        )
    ).status_code == 404
    other = User(id=uuid4(), handle="other-video", display_name="其他用户", role=UserRole.MEMBER)
    state.session.add(other)
    state.session.commit()
    state.app.dependency_overrides[get_current_user] = lambda: other
    assert (
        await state.client.get(
            f"projects/{state.project_id}/video-generations?node_id={state.node_id}"
        )
    ).status_code == 404


@pytest.mark.anyio
async def test_provider_rejection_and_directory_failure(fixture: VideoFixture) -> None:
    state = fixture
    state.create_code = 400
    created = (await submit(state)).json()
    assert created["status"] == "failed"
    assert "synthetic-video-key" not in json.dumps(created)
    state.settings.video_api_key = None
    with pytest.raises(HTTPException):
        await video.available_models(state.settings)


@pytest.mark.anyio
async def test_reference_preflight_rejects_html_without_paid_request(fixture: VideoFixture) -> None:
    fixture.reference_ok = False
    with pytest.raises(ValueError, match="公网读取"):
        await video.check_references({"image_urls": ["https://serenova.cn/reference"]})
    assert not any(request.method == "POST" for request in fixture.requests)


@pytest.mark.anyio
async def test_worker_recovers_queued_and_interrupted_tasks(
    fixture: VideoFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = fixture
    created = (await submit(state)).json()
    pending = state.session.get(VideoGeneration, UUID(created["id"]))
    assert pending is not None
    interrupted = VideoGeneration(
        id=uuid4(),
        owner_id=pending.owner_id,
        project_id=pending.project_id,
        node_id=uuid4(),
        snapshot={},
        reference_ids=[],
        status="submitting",
        created_at=datetime.now(UTC) - timedelta(minutes=20),
    )
    state.session.add(interrupted)
    state.session.commit()
    sleep = asyncio.sleep

    async def one_round(seconds: float) -> None:
        if seconds == 15:
            raise asyncio.CancelledError
        await sleep(seconds)

    monkeypatch.setattr(asyncio, "sleep", one_round)
    with pytest.raises(asyncio.CancelledError):
        await video.refresh_videos()
    state.session.refresh(pending)
    state.session.refresh(interrupted)
    assert pending.status == "processing"
    assert interrupted.status == "unknown"


def test_reference_authorization_is_removed_from_access_log() -> None:
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        0,
        "%s %s %s %s %s",
        ("client", "GET", "/api/v1/media/video-references/task/asset?token=synthetic", "1.1", 200),
        None,
    )
    assert MediaReferenceLogFilter().filter(record) is True
    assert "synthetic" not in record.getMessage()
    assert "video-references/task/asset" in record.getMessage()
