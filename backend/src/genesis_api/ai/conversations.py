"""业务会话目录、模块与归属校验及任务正文投影。"""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from genesis_api.agent.checkpoints import delete_agent_threads
from genesis_api.ai.models import AiChatRun, AiChatRunStatus, AiConversation
from genesis_api.ai.schemas import (
    AiAttachment,
    AiConversationDelete,
    AiConversationDetail,
    AiConversationMessage,
    AiGenerationMetrics,
)
from genesis_api.billing.service import source_billing


def delete_conversations(
    session: Session,
    user_id: UUID,
    selection: AiConversationDelete,
    surface: str = "studio",
) -> int:
    """原子删除当前用户选中的历史、回复快照与框架执行记录。

    会话锁与创建生成任务共用，阻止校验后插入新任务。存在待执行或
    运行中的任务时整批拒绝；未知及不属于当前用户的标识不产生影响。

    Args:
        session: 当前业务事务，清理 checkpoint 也复用此连接。
        user_id: 已认证的对话所有者。
        selection: 明确的选择范围，全部历史不受前端分页影响。
        surface: 历史所属模块，全选也仅影响该模块。

    Returns:
        实际删除的对话数量。

    Raises:
        HTTPException: 任务仍在运行时返回 409；存储失败时返回 503。
    """
    query = select(AiConversation).where(
        AiConversation.user_id == user_id, AiConversation.surface == surface
    )
    if selection.scope == "selected":
        query = query.where(AiConversation.id.in_(set(selection.ids)))
    else:
        query = query.where(AiConversation.id.not_in(set(selection.excluded_ids)))
    conversations = session.scalars(query.order_by(AiConversation.id).with_for_update()).all()
    ids = [item.id for item in conversations]
    if not ids:
        return 0
    runs = session.scalars(select(AiChatRun).where(AiChatRun.conversation_id.in_(ids))).all()
    if any(run.status in (AiChatRunStatus.PENDING, AiChatRunStatus.RUNNING) for run in runs):
        raise HTTPException(409, "所选对话仍有任务正在生成，请先停止或等待完成后再删除")
    # 当前运行时使用会话 ID；同时清理早期任务可能使用过的线程标识。
    threads = [str(item) for item in ids]
    threads.extend(thread for run in runs for thread in (str(run.id), run.thread_id))
    try:
        delete_agent_threads(session.connection().connection.driver_connection, threads)
        session.execute(delete(AiChatRun).where(AiChatRun.conversation_id.in_(ids)))
        session.execute(delete(AiConversation).where(AiConversation.id.in_(ids)))
        session.commit()
    except Exception:
        session.rollback()
        raise HTTPException(503, "暂时无法完成删除，请重试") from None
    return len(ids)


def owned_conversation(
    session: Session,
    user_id: UUID,
    conversation_id: UUID,
    surface: str = "studio",
) -> AiConversation:
    """按登录用户读取并锁定会话，隐藏其他用户记录是否存在。"""
    conversation = session.scalar(
        select(AiConversation)
        .where(
            AiConversation.id == conversation_id,
            AiConversation.user_id == user_id,
            AiConversation.surface == surface,
        )
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
                    messages.append(
                        AiConversationMessage(
                            role="user",
                            content=str(message.get("content", "")),
                            run_id=run.id,
                            status=run.status,
                            attachments=[
                                AiAttachment.model_validate(item)
                                for item in message.get("attachments", [])
                            ],
                        )
                    )
        messages.append(
            AiConversationMessage(
                role="assistant",
                content=run.content,
                run_id=run.id,
                status=run.status,
                error=run.error,
                proposals=run.proposals or [],
                tool_calls=run.tool_calls or [],
                metrics=AiGenerationMetrics.model_validate(run.generation_metrics)
                if run.generation_metrics is not None
                else None,
                billing=source_billing(session, run.id),
            )
        )
    return AiConversationDetail(
        id=conversation.id,
        title=conversation.title,
        title_source=conversation.title_source,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        messages=messages,
    )


def prepare_conversation_run(
    session: Session,
    user_id: UUID,
    conversation_id: UUID,
    surface: str,
) -> None:
    """串行创建同一会话的任务，避免并发写入同一个 checkpoint。"""
    if surface not in ("studio", "media"):
        raise HTTPException(422, "当前模块尚不支持历史对话")
    conversation = owned_conversation(session, user_id, conversation_id, surface)
    active = session.scalar(
        select(AiChatRun.id)
        .where(
            AiChatRun.conversation_id == conversation.id,
            AiChatRun.status.in_([AiChatRunStatus.PENDING, AiChatRunStatus.RUNNING]),
        )
        .limit(1)
    )
    if active is not None:
        raise HTTPException(409, "这段对话仍在生成，请等待完成或停止后再发送")
    conversation.updated_at = datetime.now(UTC)
