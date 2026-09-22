from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from genesis_api.ai.models import AiChatRunStatus

AiSurface = Literal["blog", "studio", "tools"]
AiProvider = Literal["openai", "grok", "gemini", "claude", "mimo"]
AiExecutionMode = Literal["automatic", "approval_required"]
MessageRole = Literal["user", "assistant"]


class AiMessage(BaseModel):
    role: MessageRole
    content: str = Field(min_length=1)


class AiContext(BaseModel):
    route: str | None = None
    section: str | None = None
    page_type: str | None = None
    post_id: str | None = None
    title: str | None = None
    excerpt: str | None = None
    content_markdown: str | None = None
    editor_status: str | None = None
    selected_text: str | None = None
    page: dict[str, object] | None = None
    article_summary: dict[str, object] | None = None
    articles: list[dict[str, object]] | None = None
    current_post: dict[str, object] | None = None
    available_tools: list[dict[str, object]] | None = None
    write_policy: str | None = None


class AiChatRequest(BaseModel):
    surface: AiSurface
    messages: list[AiMessage] = Field(min_length=1, max_length=40)
    context: AiContext | None = None
    provider: AiProvider | None = None
    model: str | None = None
    actor_id: UUID | None = Field(default=None, exclude=True)
    actor_role: str | None = Field(default=None, exclude=True)
    resume_from_checkpoint: bool = Field(default=False, exclude=True)
    execution_mode: AiExecutionMode = "approval_required"


class AiChatRunCreated(BaseModel):
    id: UUID
    status: AiChatRunStatus


class AiChatRunSnapshot(BaseModel):
    id: UUID
    status: AiChatRunStatus
    content: str
    sequence: int
    error: str | None = None


class AiError(BaseModel):
    error: str
