from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import cast
from uuid import uuid4

import pytest
from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from genesis_api.ai.models import AiChatRun, AiChatRunStatus
from genesis_api.ai.runs import (
    AiChatRunManager,
    ChatStreamer,
    _configured_model,
    create_ai_chat_run,
    get_ai_chat_run_snapshot,
)
from genesis_api.ai.schemas import AiChatRequest, AiChatRunSnapshot, AiMessage
from genesis_api.api.routes import ai as ai_route
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.identity.models import User, UserRole


class FakeChatService:
    def __init__(self, _: Settings) -> None:
        pass

    async def stream(self, _: AiChatRequest, *, thread_id: str = "") -> AsyncIterator[str]:
        yield "断点"
        await asyncio.sleep(0.01)
        yield "续传"


def build_session_factory() -> sessionmaker[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker[Session](bind=engine, expire_on_commit=False)


@pytest.mark.anyio
async def test_background_run_persists_output_without_stream_subscriber() -> None:
    session_factory = build_session_factory()
    user_id = uuid4()
    with session_factory() as session:
        session.add(
            User(
                id=user_id,
                handle="owner",
                display_name="Owner",
                role=UserRole.OWNER,
            )
        )
        session.commit()
        created = create_ai_chat_run(
            session,
            user_id=user_id,
            request=AiChatRequest(
                surface="studio",
                messages=[AiMessage(role="user", content="继续输出")],
            ),
            settings=Settings(text_openai_model="test-model"),
        )

    manager = AiChatRunManager(
        session_factory,
        cast(type[ChatStreamer], FakeChatService),
        flush_interval=0,
        flush_size=1,
    )
    manager.start(
        created.id,
        AiChatRequest(
            surface="studio",
            messages=[AiMessage(role="user", content="继续输出")],
        ),
        Settings(text_openai_model="test-model"),
    )

    snapshot = None
    for _ in range(100):
        await asyncio.sleep(0.01)
        with session_factory() as session:
            snapshot = get_ai_chat_run_snapshot(
                session,
                run_id=created.id,
                user_id=user_id,
            )
        if snapshot is not None and snapshot.status is AiChatRunStatus.COMPLETED:
            break

    assert snapshot is not None
    assert snapshot.status is AiChatRunStatus.COMPLETED
    assert snapshot.content == "断点续传"
    assert snapshot.sequence == 2
    await manager.shutdown()


def test_run_snapshot_is_scoped_to_owner() -> None:
    session_factory = build_session_factory()
    owner_id = uuid4()
    with session_factory() as session:
        session.add(
            User(
                id=owner_id,
                handle="owner",
                display_name="Owner",
                role=UserRole.OWNER,
            )
        )
        session.commit()
        created = create_ai_chat_run(
            session,
            user_id=owner_id,
            request=AiChatRequest(
                surface="studio",
                messages=[AiMessage(role="user", content="测试权限")],
            ),
            settings=Settings(text_openai_model="test-model"),
        )
        snapshot = get_ai_chat_run_snapshot(
            session,
            run_id=created.id,
            user_id=uuid4(),
        )

    assert snapshot is None


def test_provider_model_selection_and_request_persistence() -> None:
    settings = Settings(
        text_grok_model="grok-model",
        text_gemini_model="gemini-model",
        text_claude_model="claude-model",
    )
    assert _configured_model(settings, "openai") == settings.text_openai_model
    assert _configured_model(settings, "grok") == "grok-model"
    assert _configured_model(settings, "gemini") == "gemini-model"
    assert _configured_model(settings, "claude") == "claude-model"

    session_factory = build_session_factory()
    user_id = uuid4()
    with session_factory() as session:
        session.add(User(id=user_id, handle="owner", display_name="Owner", role=UserRole.OWNER))
        session.commit()
        created = create_ai_chat_run(
            session,
            user_id=user_id,
            request=AiChatRequest(
                surface="studio",
                messages=[AiMessage(role="user", content="保存")],
                actor_id=user_id,
                actor_role="owner",
            ),
            settings=settings,
        )
        run = session.get(AiChatRun, created.id)
        assert run is not None
        assert run.request_payload["actor_id"] == str(user_id)
        assert run.request_payload["messages"] == [{"role": "user", "content": "保存"}]


@pytest.mark.anyio
async def test_startup_recovers_interrupted_runs() -> None:
    session_factory = build_session_factory()
    user_id = uuid4()
    run_id = uuid4()
    with session_factory() as session:
        session.add(
            User(
                id=user_id,
                handle="owner",
                display_name="Owner",
                role=UserRole.OWNER,
            )
        )
        session.add(
            AiChatRun(
                id=run_id,
                user_id=user_id,
                surface="studio",
                provider="openai",
                model="test-model",
                status=AiChatRunStatus.RUNNING,
                content="已有内容",
                request_payload={
                    "surface": "studio",
                    "messages": [{"role": "user", "content": "恢复任务"}],
                    "execution_mode": "approval_required",
                    "actor_id": str(user_id),
                    "actor_role": "owner",
                },
            )
        )
        session.commit()

    manager = AiChatRunManager(session_factory, cast(type[ChatStreamer], FakeChatService))
    await manager.recover_interrupted_runs(Settings(text_openai_model="test-model"))

    for _ in range(100):
        await asyncio.sleep(0.01)
        with session_factory() as session:
            current = session.get(AiChatRun, run_id)
            if current is not None and current.status is AiChatRunStatus.COMPLETED:
                break

    with session_factory() as session:
        run = session.get(AiChatRun, run_id)
        assert run is not None
        assert run.status is AiChatRunStatus.COMPLETED
        assert run.content == "断点续传"
        assert run.error is None
        assert run.sequence == 2
    await manager.shutdown()


@pytest.mark.anyio
async def test_unrecoverable_legacy_run_is_failed() -> None:
    session_factory = build_session_factory()
    user_id = uuid4()
    run_id = uuid4()
    with session_factory() as session:
        session.add(User(id=user_id, handle="owner", display_name="Owner", role=UserRole.OWNER))
        session.add(
            AiChatRun(
                id=run_id,
                user_id=user_id,
                surface="studio",
                provider="openai",
                status=AiChatRunStatus.RUNNING,
                request_payload={},
            )
        )
        session.commit()
    manager = AiChatRunManager(session_factory, cast(type[ChatStreamer], FakeChatService))
    await manager.recover_interrupted_runs(Settings())
    with session_factory() as session:
        run = session.get(AiChatRun, run_id)
        assert run is not None
        assert run.status is AiChatRunStatus.FAILED
        assert "缺少可恢复" in (run.error or "")


@pytest.mark.anyio
async def test_run_manager_persists_runtime_and_provider_errors() -> None:
    session_factory = build_session_factory()
    user_id = uuid4()
    with session_factory() as session:
        session.add(User(id=user_id, handle="owner", display_name="Owner", role=UserRole.OWNER))
        session.commit()

    class RuntimeFailure:
        def __init__(self, _: Settings) -> None:
            pass

        async def stream(self, _: AiChatRequest, *, thread_id: str = "") -> AsyncIterator[str]:
            if False:
                yield thread_id
            raise RuntimeError("配置错误")

    class PermissionDeniedError(Exception):
        pass

    class ProviderFailure:
        def __init__(self, _: Settings) -> None:
            pass

        async def stream(self, _: AiChatRequest, *, thread_id: str = "") -> AsyncIterator[str]:
            if False:
                yield thread_id
            raise PermissionDeniedError("blocked")

    async def execute(factory: object) -> AiChatRun:
        request = AiChatRequest(
            surface="studio", messages=[AiMessage(role="user", content="失败")]
        )
        with session_factory() as session:
            created = create_ai_chat_run(
                session, user_id=user_id, request=request, settings=Settings()
            )
        manager = AiChatRunManager(
            session_factory,
            cast(type[ChatStreamer], factory),
            flush_interval=0,
        )
        manager.start(created.id, request, Settings())
        for _ in range(100):
            await asyncio.sleep(0.01)
            with session_factory() as session:
                run = session.get(AiChatRun, created.id)
                if run is not None and run.status is AiChatRunStatus.FAILED:
                    await manager.shutdown()
                    return run
        raise AssertionError("run did not fail")

    runtime_run = await execute(RuntimeFailure)
    assert runtime_run.error == "配置错误"
    provider_run = await execute(ProviderFailure)
    assert "模型服务拒绝" in (provider_run.error or "")


@pytest.mark.anyio
async def test_shutdown_leaves_cancelled_run_recoverable() -> None:
    session_factory = build_session_factory()
    user_id = uuid4()
    with session_factory() as session:
        session.add(User(id=user_id, handle="owner", display_name="Owner", role=UserRole.OWNER))
        session.commit()
        request = AiChatRequest(
            surface="studio", messages=[AiMessage(role="user", content="等待")]
        )
        created = create_ai_chat_run(
            session, user_id=user_id, request=request, settings=Settings()
        )

    class SlowService:
        def __init__(self, _: Settings) -> None:
            pass

        async def stream(self, _: AiChatRequest, *, thread_id: str = "") -> AsyncIterator[str]:
            await asyncio.sleep(10)
            yield thread_id

    manager = AiChatRunManager(session_factory, cast(type[ChatStreamer], SlowService))
    manager.start(created.id, request, Settings())
    await asyncio.sleep(0.01)
    await manager.shutdown()
    with session_factory() as session:
        run = session.get(AiChatRun, created.id)
        assert run is not None
        assert run.status is AiChatRunStatus.RUNNING

@pytest.mark.anyio
async def test_stream_response_replays_snapshot_before_live_delta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_id = uuid4()
    user_id = uuid4()
    snapshots = iter(
        [
            AiChatRunSnapshot(
                id=run_id,
                status=AiChatRunStatus.RUNNING,
                content="刷新前已生成",
                sequence=1,
            ),
            AiChatRunSnapshot(
                id=run_id,
                status=AiChatRunStatus.COMPLETED,
                content="刷新前已生成，刷新后继续",
                sequence=2,
            ),
        ]
    )
    monkeypatch.setattr(ai_route, "_load_snapshot", lambda *_: next(snapshots))

    class ConnectedRequest:
        async def is_disconnected(self) -> bool:
            return False

    response = ai_route._stream_response(
        run_id,
        user_id,
        cast(Request, ConnectedRequest()),
    )
    body_parts: list[str] = []
    async for chunk in response.body_iterator:
        body_parts.append(chunk if isinstance(chunk, str) else bytes(chunk).decode())
    body = "".join(body_parts)

    assert '"type": "snapshot"' in body
    assert '"content": "刷新前已生成"' in body
    assert '"type": "token"' in body
    assert '"content": "，刷新后继续"' in body
    assert '"type": "done"' in body


def test_extract_stream_text_supports_langgraph_message_shapes() -> None:
    from langchain_core.messages import AIMessage, HumanMessage

    from genesis_api.agent.runtime import _message_text

    assert _message_text(AIMessage(content="纯文本")) == ["纯文本"]
    assert _message_text(AIMessage(content=[{"type": "text", "text": "块一"}])) == [
        "块一",
    ]
    assert _message_text(HumanMessage(content="用户消息")) == []
