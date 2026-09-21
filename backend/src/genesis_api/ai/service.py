from __future__ import annotations

from collections.abc import AsyncIterator

from genesis_api.agent.runtime import EmbeddedAgentRuntime, embedded_agent_runtime
from genesis_api.ai.schemas import AiChatRequest
from genesis_api.core.config import Settings


class AgentService:
    """直接调用进程内 LangGraph，不依赖 LangGraph Agent Server。"""

    def __init__(
        self,
        settings: Settings,
        runtime: EmbeddedAgentRuntime = embedded_agent_runtime,
    ) -> None:
        self.settings = settings
        self.runtime = runtime

    async def stream(
        self, request: AiChatRequest, *, thread_id: str
    ) -> AsyncIterator[str]:
        async for text in self.runtime.stream(request, self.settings, thread_id=thread_id):
            yield text


class AiProviderError(RuntimeError):
    """统一表示上游模型提供商调用错误。"""
