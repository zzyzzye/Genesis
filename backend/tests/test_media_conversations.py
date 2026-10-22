"""验证影音会话复用现有任务，同时隔离模块、用户与批量操作范围。"""

from collections.abc import Iterator
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from genesis_api.ai import conversations
from genesis_api.ai.models import AiChatRun, AiChatRunStatus, AiConversation
from genesis_api.ai.runs import create_ai_chat_run
from genesis_api.ai.schemas import AiChatRequest, AiMessage
from genesis_api.api.dependencies import get_current_user
from genesis_api.api.routes.ai import router
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.database.session import get_session
from genesis_api.identity.models import User, UserRole


@pytest.fixture
def client() -> Iterator[tuple[TestClient, Session, User]]:
    """所有操作仅针对内存数据库，不触碰真实历史或模型。"""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        user = User(id=uuid4(), handle="media-owner", display_name="创作者", role=UserRole.OWNER)
        session.add(user)
        session.commit()
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_session] = lambda: session
        with TestClient(app) as http:
            yield http, session, user
    engine.dispose()


def test_directory_detail_rename_and_delete_are_surface_scoped(
    client: tuple[TestClient, Session, User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """同一用户也不能跨模块查看、重命名、续写或批量删除历史。"""
    http, session, _user = client
    blog = http.post("/ai/chat/conversations").json()["id"]
    media = http.post("/ai/chat/conversations?surface=media").json()["id"]
    assert [item["id"] for item in http.get("/ai/chat/conversations").json()] == [blog]
    history = http.get("/ai/chat/conversations?surface=media").json()
    assert [item["id"] for item in history] == [media]
    assert http.get(f"/ai/chat/conversations/{blog}?surface=media").status_code == 404
    assert (
        http.patch(
            f"/ai/chat/conversations/{blog}?surface=media",
            json={"title": "错误模块"},
        ).status_code
        == 404
    )
    renamed = http.patch(
        f"/ai/chat/conversations/{media}?surface=media",
        json={"title": "雨夜分镜"},
    )
    assert renamed.json()["title"] == "雨夜分镜"
    foreign = AiConversation(user_id=uuid4(), surface="media")
    session.add(foreign)
    session.commit()
    assert http.get(f"/ai/chat/conversations/{foreign.id}?surface=media").status_code == 404
    monkeypatch.setattr(conversations, "delete_agent_threads", lambda *_: None)
    response = http.post(
        "/ai/chat/conversations/bulk-delete?surface=media",
        json={"scope": "all"},
    )
    assert response.json() == {"deleted_count": 1}
    assert http.get(f"/ai/chat/conversations/{media}?surface=media").status_code == 404
    assert http.get(f"/ai/chat/conversations/{blog}").status_code == 200
    assert session.get(AiConversation, foreign.id) is not None


def test_member_media_history_preserves_studio_owner_boundary(
    client: tuple[TestClient, Session, User],
) -> None:
    """普通账户可以管理自己的影音历史，不能访问博客后台历史。"""
    http, session, user = client
    user.role = UserRole.MEMBER
    session.commit()
    assert http.post("/ai/chat/conversations").status_code == 403
    assert http.get("/ai/chat/conversations").status_code == 403
    assert http.post("/ai/chat/conversations?surface=media").status_code == 201
    assert len(http.get("/ai/chat/conversations?surface=media").json()) == 1
    assert http.post("/ai/chat/conversations?surface=toolbox").status_code == 422


def test_media_run_serialization_and_restored_snapshot(
    client: tuple[TestClient, Session, User],
) -> None:
    """影音续写只接受当前会话的新消息，未完成任务阻止重复启动。"""
    http, session, user = client
    created = http.post("/ai/chat/conversations?surface=media").json()
    conversation = conversations.owned_conversation(session, user.id, UUID(created["id"]), "media")
    request = AiChatRequest(
        surface="media",
        conversation_id=conversation.id,
        messages=[AiMessage(role="user", content="规划六个镜头")],
    )
    run = create_ai_chat_run(session, user_id=user.id, request=request, settings=Settings())
    with pytest.raises(HTTPException) as busy:
        create_ai_chat_run(session, user_id=user.id, request=request, settings=Settings())
    assert busy.value.status_code == 409
    stored = session.get(AiChatRun, run.id)
    assert stored is not None
    stored.status = AiChatRunStatus.COMPLETED
    stored.content = "雨夜街道、窗边人物。"
    session.commit()
    restored = http.get(f"/ai/chat/conversations/{conversation.id}?surface=media").json()
    assert [item["content"] for item in restored["messages"]] == ["规划六个镜头", stored.content]
    with pytest.raises(HTTPException) as wrong_surface:
        create_ai_chat_run(
            session,
            user_id=user.id,
            request=request.model_copy(update={"surface": "studio"}),
            settings=Settings(),
        )
    assert wrong_surface.value.status_code == 404
