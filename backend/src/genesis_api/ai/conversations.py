"""博客会话目录、归属校验与任务正文投影。"""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.ai.models import AiChatRun, AiChatRunStatus, AiConversation
from genesis_api.ai.schemas import AiConversationDetail, AiConversationMessage


def owned_conversation(session: Session, user_id: UUID, conversation_id: UUID) -> AiConversation:
    """按登录用户读取并锁定会话，隐藏其他用户记录是否存在。"""
    conversation = session.scalar(
        select(AiConversation)
        .where(AiConversation.id == conversation_id, AiConversation.user_id == user_id)
        .with_for_update()
    )
    if conversation is None:
        raise HTTPException(404, "对话不存在")
    return conversation


def conversation_detail(session: Session, conversation: AiConversation) -> AiConversationDetail:
    """从任务快照构建消息，不暴露请求中的身份与编辑器上下文。"""
    runs = session.scalars(
        select(AiChatRun)
        .where(AiChatRun.conversation_id == conversation.id)
        .order_by(AiChatRun.created_at, AiChatRun.id)
    ).all()
    messages = []
    for run in runs:
        inputs = run.request_payload.get("messages", [])
        if isinstance(inputs, list):
            for message in inputs:
                if isinstance(message, dict) and message.get("role") == "user":
                    messages.append(AiConversationMessage(
                        role="user", content=str(message.get("content", "")),
                        run_id=run.id, status=run.status,
                    ))
        messages.append(AiConversationMessage(
            role="assistant", content=run.content, run_id=run.id,
            status=run.status, error=run.error,
        ))
    return AiConversationDetail(
        id=conversation.id, title=conversation.title, title_source=conversation.title_source,
        created_at=conversation.created_at, updated_at=conversation.updated_at, messages=messages,
    )


def prepare_conversation_run(
    session: Session, user_id: UUID, conversation_id: UUID, surface: str,
) -> None:
    """串行创建同一会话的任务，避免并发写入同一个 checkpoint。"""
    if surface != "studio":
        raise HTTPException(422, "历史对话目前仅用于博客工作台")
    conversation = owned_conversation(session, user_id, conversation_id)
    active = session.scalar(select(AiChatRun.id).where(
        AiChatRun.conversation_id == conversation.id,
        AiChatRun.status.in_([AiChatRunStatus.PENDING, AiChatRunStatus.RUNNING]),
    ).limit(1))
    if active is not None:
        raise HTTPException(409, "这段对话仍在生成，请等待完成或停止后再发送")
    conversation.updated_at = datetime.now(UTC)
