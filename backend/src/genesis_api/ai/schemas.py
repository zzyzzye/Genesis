from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from genesis_api.ai.models import AiChatRunStatus

AiSurface = Literal["blog", "studio", "toolbox", "media"]
AiProvider = Literal["openai", "grok", "gemini", "claude", "mimo"]
AiExecutionMode = Literal["automatic", "approval_required"]
MessageRole = Literal["user", "assistant"]


class AiMessage(BaseModel):
    role: MessageRole
    content: str = Field(min_length=1)


class AiContext(BaseModel):
    """页面与编辑参考数据；权限由服务端身份决定，不能由这些字段授予。"""

    module: str | None = None
    route: str | None = None
    section: str | None = None
    page_type: str | None = None
    post_id: str | None = None
    title: str | None = None
    excerpt: str | None = None
    content_markdown: str | None = None
    editor_status: str | None = None
    selected_text: str | None = None
    selected_node: dict[str, object] | None = None
    page: dict[str, object] | None = None
    article_summary: dict[str, object] | None = None
    articles: list[dict[str, object]] | None = None
    current_post: dict[str, object] | None = None
    available_tools: list[dict[str, object]] | None = None
    write_policy: str | None = None


class AiChatRequest(BaseModel):
    """对话请求；API 在执行前覆盖调用身份，恢复标记由后台任务管理器设置。"""

    surface: AiSurface
    messages: list[AiMessage] = Field(min_length=1, max_length=40)
    context: AiContext | None = None
    provider: AiProvider | None = None
    model: str | None = None
    # None 沿用模型默认；实际可选档位由运行时依据框架 profile 校验。
    reasoning_effort: str | None = Field(default=None, min_length=1, max_length=32)
    # 内部字段不随普通 model_dump 输出；任务持久化时由管理器明确补入身份。
    actor_id: UUID | None = Field(default=None, exclude=True)
    actor_role: str | None = Field(default=None, exclude=True)
    resume_from_checkpoint: bool = Field(default=False, exclude=True)
    execution_mode: AiExecutionMode = "approval_required"


class AiChatRunCreated(BaseModel):
    id: UUID
    status: AiChatRunStatus


class AiChatRunSnapshot(BaseModel):
    """完整文本快照；SSE 根据内容及修订序号判断追加输出或替换旧内容。"""

    id: UUID
    status: AiChatRunStatus
    content: str
    sequence: int
    error: str | None = None


class AiError(BaseModel):
    error: str
