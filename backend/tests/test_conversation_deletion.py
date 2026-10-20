"""验证历史批量删除的范围、运行互斥、事务回退与路由权限。"""

from collections.abc import Iterator
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from genesis_api.agent.checkpoints import delete_agent_threads
from genesis_api.ai import conversations
from genesis_api.ai.models import AiChatRun, AiChatRunStatus, AiConversation
from genesis_api.ai.schemas import AiConversationDelete
from genesis_api.api.dependencies import get_current_user
from genesis_api.api.routes.ai import router
from genesis_api.database.base import Base
from genesis_api.database.session import get_session
from genesis_api.identity.models import User, UserRole


@pytest.fixture
def session() -> Iterator[Session]:
    """使用独立内存数据库，避免改动真实历史。"""
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as value:
        yield value
    engine.dispose()


def owner(session: Session, name: str = "owner") -> User:
    """创建当前测试的虚拟所有者。"""
    user = User(handle=name, display_name=name, role=UserRole.OWNER)
    session.add(user)
    session.commit()
    return user


def conversation(session: Session, user_id: UUID) -> AiConversation:
    """保存一段没有外部模型请求的测试历史。"""
    value = AiConversation(user_id=user_id, title="测试历史")
    session.add(value)
    session.commit()
    return value


def test_selected_delete_is_owned_idempotent_and_cleans_runs(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = owner(session)
    other = owner(session, "other")
    chosen = conversation(session, user.id)
    retained = conversation(session, user.id)
    foreign = conversation(session, other.id)
    run = AiChatRun(
        user_id=user.id,
        conversation_id=chosen.id,
        surface="studio",
        provider="mimo",
        status=AiChatRunStatus.COMPLETED,
        content="已保存的回复",
    )
    session.add(run)
    session.commit()
    threads: list[str] = []
    monkeypatch.setattr(
        conversations, "delete_agent_threads", lambda _conn, ids: threads.extend(ids)
    )
    payload = AiConversationDelete(
        scope="selected", ids=[chosen.id, chosen.id, foreign.id, uuid4()]
    )
    assert conversations.delete_conversations(session, user.id, payload) == 1
    assert session.get(AiConversation, chosen.id) is None
    assert session.get(AiChatRun, run.id) is None
    assert session.get(AiConversation, retained.id) is not None
    assert session.get(AiConversation, foreign.id) is not None
    assert str(chosen.id) in threads
    assert str(run.id) in threads
    assert run.thread_id in threads
    assert str(foreign.id) not in threads
    assert conversations.delete_conversations(session, user.id, payload) == 0


def test_all_history_includes_unloaded_pages_and_respects_exclusions(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = owner(session)
    other = owner(session, "other")
    entries = [conversation(session, user.id) for _ in range(40)]
    foreign = conversation(session, other.id)
    monkeypatch.setattr(conversations, "delete_agent_threads", lambda *_args: None)
    result = conversations.delete_conversations(
        session,
        user.id,
        AiConversationDelete(scope="all", excluded_ids=[entries[0].id]),
    )
    assert result == 39
    assert set(session.scalars(select(AiConversation.id))) == {entries[0].id, foreign.id}


@pytest.mark.parametrize("status", [AiChatRunStatus.PENDING, AiChatRunStatus.RUNNING])
def test_active_task_rejects_the_entire_batch(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
    status: AiChatRunStatus,
) -> None:
    user = owner(session)
    entries = [conversation(session, user.id) for _ in range(2)]
    session.add(
        AiChatRun(
            user_id=user.id,
            conversation_id=entries[0].id,
            surface="studio",
            provider="mimo",
            status=status,
        )
    )
    session.commit()
    cleaned: list[str] = []
    monkeypatch.setattr(
        conversations, "delete_agent_threads", lambda _conn, ids: cleaned.extend(ids)
    )
    with pytest.raises(HTTPException) as caught:
        conversations.delete_conversations(session, user.id, AiConversationDelete(scope="all"))
    assert caught.value.status_code == 409
    assert len(list(session.scalars(select(AiConversation)))) == 2
    assert not cleaned


def test_checkpoint_error_keeps_history_and_reply_snapshots(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = owner(session)
    entry = conversation(session, user.id)
    run = AiChatRun(
        user_id=user.id,
        conversation_id=entry.id,
        surface="studio",
        provider="mimo",
        status=AiChatRunStatus.FAILED,
        content="保留已经收到的正文",
    )
    session.add(run)
    session.commit()

    def fail(*_args: object) -> None:
        raise RuntimeError("模拟 checkpoint 写入失败")

    monkeypatch.setattr(conversations, "delete_agent_threads", fail)
    with pytest.raises(HTTPException) as caught:
        conversations.delete_conversations(session, user.id, AiConversationDelete(scope="all"))
    assert caught.value.status_code == 503
    assert session.get(AiConversation, entry.id) is not None
    assert session.get(AiChatRun, run.id) is not None


@pytest.mark.parametrize(
    "data",
    [
        {},
        {"scope": "selected"},
        {"scope": "all", "ids": [str(uuid4())]},
        {"scope": "selected", "ids": [str(uuid4())], "excluded_ids": [str(uuid4())]},
        {"scope": "all", "user_id": str(uuid4())},
    ],
)
def test_ambiguous_or_privilege_expanding_selection_is_rejected(data: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        AiConversationDelete.model_validate(data)


def test_delete_route_requires_owner_and_returns_actual_count(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_session] = lambda: session
    monkeypatch.setattr(conversations, "delete_agent_threads", lambda *_args: None)
    user = owner(session)
    conversation(session, user.id)
    with TestClient(app) as client:
        path = "/api/v1/ai/chat/conversations/bulk-delete"
        assert client.post(path, json={"scope": "all"}).status_code == 401
        member = User(id=uuid4(), handle="member", display_name="member", role=UserRole.MEMBER)
        app.dependency_overrides[get_current_user] = lambda: member
        assert client.post(path, json={"scope": "all"}).status_code == 403
        app.dependency_overrides[get_current_user] = lambda: user
        response = client.post(path, json={"scope": "all"})
        assert response.status_code == 200
        assert response.json() == {"deleted_count": 1}


def test_native_cleanup_rejects_unsupported_connection() -> None:
    with pytest.raises(TypeError, match="PostgreSQL"):
        delete_agent_threads(object(), [str(uuid4())])
