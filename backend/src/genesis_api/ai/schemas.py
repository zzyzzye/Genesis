from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

AiSurface = Literal["blog", "studio", "tools"]
MessageRole = Literal["user", "assistant"]


class AiMessage(BaseModel):
    role: MessageRole
    content: str = Field(min_length=1)


class AiContext(BaseModel):
    post_id: str | None = None
    title: str | None = None
    excerpt: str | None = None
    content_markdown: str | None = None
    selected_text: str | None = None


class AiChatRequest(BaseModel):
    surface: AiSurface
    messages: list[AiMessage] = Field(min_length=1, max_length=40)
    context: AiContext | None = None
    model: str | None = None


class AiError(BaseModel):
    error: str
