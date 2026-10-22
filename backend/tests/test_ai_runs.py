"""验证后台任务持久化、重启恢复、用户取消与 SSE 快照重放。"""

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

from genesis_api.agent.contracts import AgentActionProposal
from genesis_api.agent.tool_history import AgentToolCall, ToolCallHistory
from genesis_api.ai.conversations import conversation_detail
from genesis_api.ai.models import AiChatRun, AiChatRunStatus, AiConversation
from genesis_api.ai.runs import (
    AiChatRunManager,
    ChatStreamer,
    _configured_model,
    _request_from_payload,
    create_ai_chat_run,
    get_ai_chat_run_snapshot,
)
from genesis_api.ai.schemas import AiChatRequest, AiChatRunSnapshot, AiMessage
from genesis_api.api.routes import ai as ai_route
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.identity.models import User, UserRole


class FakeChatService:
    """用两个文本片段模拟模型流，供测试观察中间与完成快照。"""

    def __init__(self, _: Settings) -> None:
        """保留生产工厂的配置入参，不创建模型客户端。"""
        pass

    async def stream(self, _: AiChatRequest, *, thread_id: str = "") -> AsyncIterator[str]:
        """分两次产出固定文本，中间让出事件循环以触发异步持久化。"""
        yield "断点"
        await asyncio.sleep(0.01)
        yield "续传"


@pytest.mark.anyio
async def test_tool_history_persists_updates_and_closes_unfinished_calls() -> None:
    """工具开始在正文前持久化，同一回调不重复，结束任务保留未完成调用的中断状态。"""
    factory = build_session_factory()
    user_id = uuid4()
    request = AiChatRequest(surface="studio", messages=[AiMessage(role="user", content="读取")])
    with factory() as session:
        session.add(User(
            id=user_id, handle="tool-owner", display_name="Owner", role=UserRole.OWNER,
        ))
        session.commit()
        created = create_ai_chat_run(session, user_id=user_id, request=request, settings=Settings())

    class ToolService:
        tool_history = ToolCallHistory()

        async def stream(self, *_: object, **__: object) -> AsyncIterator[str]:
            call_id = uuid4()
            await self.tool_history.on_tool_start({"name": "lookup"}, "", run_id=call_id)
            with factory() as session:
                snapshot = get_ai_chat_run_snapshot(session, run_id=created.id, user_id=user_id)
                assert snapshot is not None and snapshot.tool_calls[0].status == "running"
                assert snapshot.content == ""
                assert get_ai_chat_run_snapshot(
                    session, run_id=created.id, user_id=uuid4(),
                ) is None
            await self.tool_history.on_tool_end("[]", run_id=call_id)
            await self.tool_history.on_tool_end("[]", run_id=call_id)
            await self.tool_history.on_tool_start({"name": "slow_tool"}, "", run_id=uuid4())
            yield "完成"

    manager = AiChatRunManager(factory, lambda _: ToolService())
    manager._semaphore = asyncio.Semaphore(1)
    await manager._generate(created.id, request, Settings())
    with factory() as session:
        snapshot = get_ai_chat_run_snapshot(session, run_id=created.id, user_id=user_id)
        assert snapshot is not None
        assert [call.status for call in snapshot.tool_calls] == ["succeeded", "interrupted"]
        assert snapshot.tool_calls[1].duration_ms is None
        assert snapshot.content == "完成"
        conversation = AiConversation(user_id=user_id, title="工具历史", title_source="manual")
        session.add(conversation)
        session.flush()
        run = session.get(AiChatRun, created.id)
        assert run is not None
        run.conversation_id = conversation.id
        session.commit()
        history = conversation_detail(session, conversation)
        assert history.messages[-1].tool_calls == snapshot.tool_calls


@pytest.mark.anyio
@pytest.mark.parametrize("recover", [False, True])
async def test_cancel_or_restart_preserves_history_without_stale_running(recover: bool) -> None:
    """取消与重启都保留历史，未结束调用不伪造成功或持续运行状态。"""
    factory = build_session_factory()
    user_id = uuid4()
    request = AiChatRequest(surface="studio", messages=[AiMessage(role="user", content="查询")])
    with factory() as session:
        session.add(User(
            id=user_id, handle="recover-owner", display_name="Owner", role=UserRole.OWNER,
        ))
        session.commit()
        created = create_ai_chat_run(session, user_id=user_id, request=request, settings=Settings())
    manager = AiChatRunManager(factory)
    call = AgentToolCall(
        id=uuid4(), name="lookup", label="读取", status="running",
        started_at="2026-10-22T00:00:00Z",
    )
    later = call.model_copy(update={"id": uuid4(), "started_at": call.started_at.replace(second=1)})
    manager._persist_tool_call_sync(created.id, later)
    manager._persist_tool_call_sync(created.id, call)
    if recover:
        restored = manager._recover_interrupted_runs_sync()
        assert len(restored) == 1 and restored[0][1].resume_from_checkpoint
    else:
        await manager.cancel(created.id)
    with factory() as session:
        snapshot = get_ai_chat_run_snapshot(session, run_id=created.id, user_id=user_id)
        assert snapshot is not None
        assert snapshot.tool_calls[0].status == "interrupted"
        assert snapshot.tool_calls[0].duration_ms is None
        assert [item.id for item in snapshot.tool_calls] == [call.id, later.id]
        assert all(item.status == "interrupted" for item in snapshot.tool_calls)


def build_session_factory() -> sessionmaker[Session]:
    """创建跨工作线程共享的内存数据库会话工厂。

    StaticPool 让多个会话访问同一个内存库；关闭线程检查是为了覆盖
    asyncio.to_thread 中的持久化路径，不代表生产数据库采用相同连接策略。

    Returns:
        已建表且提交后不使实体失效的 SQLite 会话工厂。
    """
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker[Session](bind=engine, expire_on_commit=False)


@pytest.mark.anyio
async def test_proposals_persist_separately_and_deduplicate() -> None:
    """无正文的工具提议也能保存并去重，令牌不进入正文。"""
    factory = build_session_factory()
    user_id = uuid4()
    request = AiChatRequest(surface="studio", messages=[AiMessage(role="user", content="创建草稿")])
    with factory() as session:
        session.add(User(
            id=user_id, handle="proposal-owner", display_name="Owner", role=UserRole.OWNER,
        ))
        session.commit()
        run = create_ai_chat_run(session, user_id=user_id, request=request, settings=Settings())
    proposal = AgentActionProposal(
        proposal_id=uuid4(), module="blog", action="create_draft", payload={"title": "草稿"},
        summary="创建草稿", expires_at="2099-01-01T00:00:00Z", proposal_token="test-proposal",
    )

    class ProposalService:
        async def stream(self, *_: object, **__: object) -> AsyncIterator[AgentActionProposal]:
            yield proposal
            yield proposal

    manager = AiChatRunManager(factory, lambda _: ProposalService())
    manager._semaphore = asyncio.Semaphore(1)
    await manager._generate(run.id, request, Settings())
    with factory() as session:
        snapshot = get_ai_chat_run_snapshot(session, run_id=run.id, user_id=user_id)
        assert snapshot is not None
        assert snapshot.content == ""
        assert snapshot.proposals == [proposal]
        assert snapshot.sequence == 1
        assert snapshot.status is AiChatRunStatus.COMPLETED


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

    # StaticPool 共用一条 SQLite 连接；先等待后台提交，避免读会话回滚工作线程的事务。
    await asyncio.wait_for(manager._tasks[created.id], timeout=10)
    with session_factory() as session:
        snapshot = get_ai_chat_run_snapshot(session, run_id=created.id, user_id=user_id)

    assert snapshot is not None
    assert snapshot.status is AiChatRunStatus.COMPLETED
    assert snapshot.content == "断点续传"
    assert snapshot.sequence == 2
    assert snapshot.metrics is not None
    assert snapshot.metrics.token_source == "estimated"
    assert snapshot.metrics.output_tokens == 4
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
                reasoning_effort="high",
                actor_id=user_id,
                actor_role="owner",
            ),
            settings=settings,
        )
        run = session.get(AiChatRun, created.id)
        assert run is not None
        assert run.request_payload["actor_id"] == str(user_id)
        assert run.request_payload["messages"] == [{"role": "user", "content": "保存"}]
        assert run.request_payload["reasoning_effort"] == "high"
        assert _request_from_payload(run.request_payload).reasoning_effort == "high"


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

    await asyncio.wait_for(manager._tasks[run_id], timeout=10)

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
        await asyncio.wait_for(manager._tasks[created.id], timeout=10)
        with session_factory() as session:
            run = session.get(AiChatRun, created.id)
            assert run is not None and run.status is AiChatRunStatus.FAILED
            await manager.shutdown()
            return run

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
async def test_user_cancel_marks_run_failed_instead_of_recoverable() -> None:
    session_factory = build_session_factory()
    user_id = uuid4()
    request = AiChatRequest(
        surface="studio", messages=[AiMessage(role="user", content="停止")]
    )
    with session_factory() as session:
        session.add(User(id=user_id, handle="owner", display_name="Owner", role=UserRole.OWNER))
        session.commit()
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
    await manager.cancel(created.id)
    with session_factory() as session:
        run = session.get(AiChatRun, created.id)
        assert run is not None
        assert run.status is AiChatRunStatus.FAILED
        assert run.error == "生成已由用户停止。"

@pytest.mark.anyio
async def test_stream_response_replays_snapshot_before_live_delta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_id = uuid4()
    user_id = uuid4()
    proposal = AgentActionProposal(
        proposal_id=uuid4(), module="blog", action="create_draft", payload={},
        summary="创建草稿", expires_at="2099-01-01T00:00:00Z", proposal_token="test-proposal",
    )
    tool_call = AgentToolCall(
        id=uuid4(), name="lookup", label="读取文章", status="succeeded",
        started_at="2026-10-22T00:00:00Z", duration_ms=120,
    )
    snapshots = iter(
        [
            AiChatRunSnapshot(
                id=run_id,
                status=AiChatRunStatus.RUNNING,
                content="刷新前已生成",
                sequence=1,
                proposals=[proposal],
                tool_calls=[tool_call],
            ),
            AiChatRunSnapshot(
                id=run_id,
                status=AiChatRunStatus.COMPLETED,
                content="刷新前已生成，刷新后继续",
                sequence=2,
                proposals=[proposal],
                tool_calls=[tool_call],
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
    assert body.count('"type": "proposals"') == 1
    assert body.count('"type": "tool_calls"') == 1
    assert str(tool_call.id) in body
    assert '"proposal_token": "test-proposal"' in body


def test_extract_stream_text_supports_langgraph_message_shapes() -> None:
    from langchain_core.messages import AIMessage, HumanMessage

    from genesis_api.agent.runtime import _message_text

    assert _message_text(AIMessage(content="纯文本")) == ["纯文本"]
    assert _message_text(AIMessage(content=[{"type": "text", "text": "块一"}])) == [
        "块一",
    ]
    assert _message_text(HumanMessage(content="用户消息")) == []
