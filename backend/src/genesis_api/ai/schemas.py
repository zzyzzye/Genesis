"""AI 请求、后台任务响应及快照的数据契约；身份字段仅供服务端使用。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from genesis_api.agent.contracts import AgentActionProposal
from genesis_api.ai.models import AiChatRunStatus

AiSurface = Literal["blog", "studio", "toolbox", "media"]
AiProvider = Literal["openai", "grok", "gemini", "claude", "mimo"]
AiExecutionMode = Literal["automatic", "approval_required"]
MessageRole = Literal["user", "assistant"]


class AiMessage(BaseModel):
    """客户端对话历史中的用户或助手文本，不允许客户端提交系统角色。"""

    role: MessageRole
    content: str = Field(min_length=1)


class AiContext(BaseModel):
    """页面与编辑参考数据；权限由服务端身份决定，不能由这些字段授予。

    页面提交的数据可能包含未保存草稿，不能直接视为数据库中的文章或素材。
    这些字段覆盖不同页面的上下文，具体取舍和可信记录读取由业务能力负责。

    Attributes:
        module: 页面声明的业务模块，执行前由 API 校正。
        post_id: 页面关联文章的标识，读取实际文章仍需业务层查询。
        content_markdown: 编辑器当前文本，可能尚未保存。
        selected_text: 用户选中的文本片段，供模型理解当前编辑目标。
        selected_node: 影音画布选中节点的页面快照。
        current_post: 当前文章的页面快照，不替代数据库记录。
        available_tools: 页面传入的工具说明，不赋予模型调用权限。
        write_policy: 页面提供的写入提示，不能覆盖服务端授权与确认规则。
    """

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
    action_results: list[dict[str, object]] = Field(default_factory=list)


class AiChatRequest(BaseModel):
    """对话请求；API 在执行前覆盖调用身份，恢复标记由后台任务管理器设置。"""

    surface: AiSurface
    conversation_id: UUID | None = None
    messages: list[AiMessage] = Field(min_length=1, max_length=40)
    context: AiContext | None = None
    provider: AiProvider | None = None
    model: str | None = None
    # None 沿用模型默认；实际可选档位由运行时依据框架 profile 校验。
    reasoning_effort: str | None = Field(default=None, min_length=1, max_length=32)
    # 与强度独立；None 沿用上游默认，目前 MiMo 支持明确开启或关闭。
    thinking_mode: Literal["enabled", "disabled"] | None = None
    # 内部字段不随普通 model_dump 输出；任务持久化时由管理器明确补入身份。
    actor_id: UUID | None = Field(default=None, exclude=True)
    actor_role: str | None = Field(default=None, exclude=True)
    resume_from_checkpoint: bool = Field(default=False, exclude=True)
    execution_mode: AiExecutionMode = "approval_required"


class AiChatRunCreated(BaseModel):
    """任务创建回执，只返回 ID 与状态，不表示模型已完成回答。"""

    id: UUID
    status: AiChatRunStatus


class AiConversationSummary(BaseModel):
    """会话列表条目，不包含消息或内部上下文。"""

    model_config = {"from_attributes": True}

    id: UUID
    title: str
    title_source: str
    created_at: datetime
    updated_at: datetime


class AiConversationRename(BaseModel):
    """用户指定的新标题；空白标题由服务层拒绝。"""

    title: str = Field(min_length=1, max_length=80)


class AiGenerationMetrics(BaseModel):
    """整条回复的首末正文耗时与有正文调用的用量，不包含自动标题调用。"""

    output_tokens: int | None = None
    token_source: Literal["actual", "estimated", "unavailable"] = "unavailable"
    output_seconds: float | None = None
    tokens_per_second: float | None = None
    first_token_seconds: float | None = None
    total_seconds: float = 0


class AiConversationMessage(BaseModel):
    """由生成任务构建的展示消息，包含任务状态供浏览器恢复订阅。"""

    role: MessageRole
    content: str
    run_id: UUID
    status: AiChatRunStatus
    error: str | None = None
    metrics: AiGenerationMetrics | None = None
    proposals: list[AgentActionProposal] = Field(default_factory=list)


class AiConversationDetail(AiConversationSummary):
    """会话详情，正文来自服务端任务快照。"""

    messages: list[AiConversationMessage]


class AiChatRunSnapshot(BaseModel):
    """完整文本快照；SSE 根据内容及修订序号判断追加输出或替换旧内容。

    Attributes:
        id: 后台任务标识。
        status: 任务执行状态，终态也可能没有新增文本。
        content: 当前累计文本；恢复任务时可能重置，不能始终假定只增不减。
        sequence: 内容提交修订号，不是 token 数或 SSE 事件总数。
        error: 失败时展示的错误说明，正常情况下为 None。
    """

    id: UUID
    status: AiChatRunStatus
    content: str
    sequence: int
    error: str | None = None
    metrics: AiGenerationMetrics | None = None
    proposals: list[AgentActionProposal] = Field(default_factory=list)


class AiError(BaseModel):
    """AI 错误文本响应结构，不携带上游凭据或内部请求载荷。"""

    error: str
