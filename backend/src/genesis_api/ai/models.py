from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from genesis_api.database.base import Base


class AiChatRunStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AiChatRun(Base):
    """与浏览器连接解耦的文本生成任务。"""

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
    thread_id: Mapped[str] = mapped_column(
        String(255), default=lambda: str(uuid4()), unique=True, index=True
    )
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
    sequence: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
