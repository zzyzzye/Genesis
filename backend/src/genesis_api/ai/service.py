"""AI 对话服务入口，将任务请求委托给进程内 Agent 运行时。"""

from __future__ import annotations

from collections.abc import AsyncIterator

from genesis_api.agent.contracts import AgentActionProposal
from genesis_api.agent.metrics import GenerationMetrics
from genesis_api.agent.runtime import EmbeddedAgentRuntime, embedded_agent_runtime
from genesis_api.ai.schemas import AiChatRequest
from genesis_api.core.config import Settings


class AgentService:
    """直接调用进程内 LangGraph，不依赖 LangGraph Agent Server。

    服务实例持有应用配置和运行时引用；图创建、工具执行与 checkpoint
    由运行时负责，此处不维护另一套 Agent 编排或对话状态。
    """

    def __init__(
        self,
        settings: Settings,
        runtime: EmbeddedAgentRuntime = embedded_agent_runtime,
    ) -> None:
        """绑定当前服务使用的配置与运行时，不在此初始化运行时。

        Args:
            settings: 本次服务调用使用的应用配置。
            runtime: Agent 执行入口；默认复用模块级实例，也可注入测试替身。
                真实运行时的启动与关闭由应用生命周期管理。
        """
        self.settings = settings
        self.runtime = runtime
        self.metrics = GenerationMetrics()

    async def stream(
        self, request: AiChatRequest, *, thread_id: str
    ) -> AsyncIterator[str | AgentActionProposal]:
        """转发运行时产出的正文片段与结构化操作提议。

        Args:
            request: 对话消息、页面上下文、模型选项及服务端设置的用户身份。
            thread_id: checkpoint 的任务标识，用于隔离与恢复执行状态。

        Yields:
            模型文本片段或可信工具提议，不在此重新拼接或缓存。

        Raises:
            RuntimeError: 运行时未初始化，或缺少身份、模型配置，
                或所选思考强度不受支持；运行时异常原样向上传递。
            ValueError: 供应商、业务模块不受支持，或模型客户端配置无效。
        """
        # 服务层只传递请求和线程标识，图创建与模型协议适配统一由 runtime 负责。
        async for text in self.runtime.stream(
            request, self.settings, thread_id=thread_id, metrics=self.metrics,
        ):
            yield text

    async def generate_title(self, request: AiChatRequest) -> str:
        """复用运行时的模型适配生成会话名，不调用业务工具。"""
        return await self.runtime.generate_title(request, self.settings)


class AiProviderError(RuntimeError):
    """表示上游模型提供商调用错误，供调用方按错误类型处理。

    stream 不会自动把运行时或 SDK 异常转换为此类型。
    """
