"""验证会话归属、任务串行、正文恢复及自动命名的并发保护。"""

from typing import cast
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from genesis_api.ai.conversations import conversation_detail, owned_conversation
from genesis_api.ai.models import AiChatRun, AiChatRunStatus, AiConversation
from genesis_api.ai.runs import AiChatRunManager, create_ai_chat_run
from genesis_api.ai.schemas import AiChatRequest, AiConversationRename, AiMessage
from genesis_api.ai.service import AgentService
from genesis_api.api.routes import ai
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.identity.models import User, UserRole


@pytest.fixture
def sessions() -> sessionmaker[Session]:
    """创建可跨后台持久化线程复用的隔离数据库。"""
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


def test_conversation_ownership_history_and_rename(sessions: sessionmaker[Session]) -> None:
    with sessions() as session:
        owner = User(id=uuid4(), handle="author", display_name="作者", role=UserRole.OWNER)
        session.add(owner)
        session.commit()
        created = ai.create_conversation(owner, session)
        conversation = owned_conversation(session, owner.id, created.id)
        with pytest.raises(HTTPException) as denied:
            owned_conversation(session, uuid4(), created.id)
        assert denied.value.status_code == 404
        request = AiChatRequest(
            surface="studio", conversation_id=created.id,
            messages=[AiMessage(role="user", content="规划写作主题")],
        )
        run = create_ai_chat_run(session, user_id=owner.id, request=request, settings=Settings())
        with pytest.raises(HTTPException) as busy:
            create_ai_chat_run(session, user_id=owner.id, request=request, settings=Settings())
        assert busy.value.status_code == 409
        stored = session.get(AiChatRun, run.id)
        assert stored is not None
        stored.status = AiChatRunStatus.COMPLETED
        stored.content = "可以从开发经验开始。"
        session.commit()
        detail = conversation_detail(session, conversation)
        assert [message.content for message in detail.messages] == [
            "规划写作主题", "可以从开发经验开始。",
        ]
        assert detail.messages[-1].run_id == run.id
        renamed = ai.rename_conversation(
            created.id, AiConversationRename(title="  写作选题  "), owner, session
        )
        assert renamed.title == "写作选题"
        assert renamed.title_source == "manual"
        assert len(ai.list_conversations(owner, session, offset=0, limit=30)) == 1
        assert ai.list_conversations(owner, session, offset=1, limit=30) == []
        assert ai.get_conversation(created.id, owner, session).title == "写作选题"
        with pytest.raises(HTTPException, match="请输入"):
            ai.rename_conversation(created.id, AiConversationRename(title="  "), owner, session)
        with pytest.raises(HTTPException) as invalid:
            create_ai_chat_run(
                session, user_id=owner.id,
                request=request.model_copy(update={"surface": "media"}), settings=Settings(),
            )
        assert invalid.value.status_code == 422
        with pytest.raises(HTTPException) as history:
            create_ai_chat_run(
                session, user_id=owner.id,
                request=request.model_copy(update={"messages": request.messages * 2}),
                settings=Settings(),
            )
        assert history.value.status_code == 422


@pytest.mark.anyio
async def test_title_generation_does_not_overwrite_manual_rename(
    sessions: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch,
) -> None:
    with sessions() as session:
        conversation = AiConversation(user_id=uuid4())
        session.add(conversation)
        session.commit()
        conversation_id = conversation.id
    request = AiChatRequest(
        surface="studio", conversation_id=conversation_id,
        messages=[AiMessage(role="user", content="帮我规划博客")],
    )

    async def generate(_: AgentService, __: AiChatRequest) -> str:
        with sessions() as session:
            stored = cast(AiConversation, session.get(AiConversation, conversation_id))
            stored.title = "我的手动标题"
            stored.title_source = "manual"
            session.commit()
        return "博客规划"

    monkeypatch.setattr(AgentService, "generate_title", generate)
    manager = AiChatRunManager(sessions)
    await manager._generate_title(request, Settings())
    with sessions() as session:
        stored = cast(AiConversation, session.get(AiConversation, conversation_id))
        assert stored.title == "我的手动标题"
    await manager._generate_title(request, Settings())


@pytest.mark.anyio
@pytest.mark.parametrize("failure", [False, True])
async def test_title_success_and_fallback(
    sessions: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, failure: bool,
) -> None:
    with sessions() as session:
        conversation = AiConversation(user_id=uuid4())
        session.add(conversation)
        session.commit()
        conversation_id = conversation.id

    async def generate(_: AgentService, __: AiChatRequest) -> str:
        if failure:
            raise RuntimeError("模拟上游失败")
        return "博客选题规划"

    monkeypatch.setattr(AgentService, "generate_title", generate)
    await AiChatRunManager(sessions)._generate_title(AiChatRequest(
        surface="studio", conversation_id=conversation_id,
        messages=[AiMessage(role="user", content="规划博客")],
    ), Settings())
    with sessions() as session:
        stored = cast(AiConversation, session.get(AiConversation, conversation_id))
        assert stored.title == ("规划博客" if failure else "博客选题规划")
        assert stored.title_source == ("fallback" if failure else "model")
