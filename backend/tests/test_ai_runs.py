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


@pytest.mark.anyio
async def test_startup_marks_interrupted_runs_as_failed() -> None:
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
            )
        )
        session.commit()

    manager = AiChatRunManager(session_factory, cast(type[ChatStreamer], FakeChatService))
    await manager.fail_interrupted_runs()

    with session_factory() as session:
        run = session.get(AiChatRun, run_id)
        assert run is not None
        assert run.status is AiChatRunStatus.FAILED
        assert run.content == "已有内容"
        assert run.error == "服务已重启，生成任务中断，请重新发起。"

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
    from genesis_api.ai.service import _extract_stream_text

    assert _extract_stream_text({"content": "纯文本"}) == ["纯文本"]
    assert _extract_stream_text({"content": [{"text": "块一"}, {"text": "块二"}]}) == [
        "块一",
        "块二",
    ]
    assert _extract_stream_text(({"content": "消息"}, {"langgraph_node": "agent"})) == ["消息"]
