"""AI 后台任务及文本快照的持久化结构，与 LangGraph checkpoint 分工存储。"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from genesis_api.database.base import Base


class AiChatRunStatus(StrEnum):
    """后台任务状态；用户主动停止也记录为 failed，并保存停止原因。"""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AiConversation(Base):
    """博客会话目录；正文复用生成任务，执行状态由 LangGraph 保存。"""

    __tablename__ = "ai_conversations"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(80), default="新对话")
    title_source: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AiChatRun(Base):
    """与浏览器连接解耦的文本生成任务。

    content 与 sequence 支撑浏览器重连；request_payload 支撑服务端恢复。
    这些字段不替代 LangGraph 的执行 checkpoint；实际执行线程由运行时调用决定。
    """

    __tablename__ = "ai_chat_runs"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    surface: Mapped[str] = mapped_column(String(20))
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    conversation_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("ai_conversations.id"), nullable=True, index=True
    )
    thread_id: Mapped[str] = mapped_column(
        String(255), default=lambda: str(uuid4()), unique=True, index=True
    )
    # 恢复所需的请求与调用身份由服务端保存，不在任务快照接口中返回。
    request_payload: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    status: Mapped[AiChatRunStatus] = mapped_column(
        Enum(
            AiChatRunStatus,
            native_enum=False,
            values_callable=lambda enum: [member.value for member in enum],
        ),
        default=AiChatRunStatus.PENDING,
        index=True,
    )
    content: Mapped[str] = mapped_column(Text, default="")
    # 内容批次的修订序号，不是 token 数；恢复时也会递增以通知客户端重置快照。
    sequence: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
