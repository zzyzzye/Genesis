from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any, cast

from langgraph_sdk import get_client
from langgraph_sdk.errors import NotFoundError

from genesis_api.ai.schemas import AiChatRequest
from genesis_api.core.config import Settings

logger = logging.getLogger(__name__)


class LangGraphAgentService:
    """通过 LangGraph SDK 调用独立 Agent，不向浏览器暴露 Agent 地址。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def stream(
        self, request: AiChatRequest, *, thread_id: str
    ) -> AsyncIterator[str]:
        headers = {}
        if self.settings.agent_internal_token is not None:
            headers["x-genesis-internal-token"] = (
                self.settings.agent_internal_token.get_secret_value()
            )
        client = get_client(url=self.settings.agent_url, headers=headers or None, timeout=None)
        input_data = {
            "messages": [item.model_dump() for item in request.messages],
            "context": request.context.model_dump(exclude_none=True) if request.context else {},
            "actor_context": request.agent_context,
            "execution_mode": request.execution_mode,
            # Agent 图按单次请求选择模型；不能只在后端记录 provider/model，
            # 否则前端切换模型不会影响实际的模型调用。
            "provider": request.provider,
            "model": request.model,
        }
        # LangGraph API 的 runs.stream 不会自动创建 thread；
        # Backend 的 run ID 同时作为 Agent thread ID，
        # 这样任务重试和断线续传都能复用同一个对话线程。开发环境的 LangGraph server 使用内存存储，
        # 重启后数据库里的 run 仍然存在，但对应 thread 已丢失，因此在首次请求发现 thread 不存在时
        # 重新创建一次并重试。已经产出过 token 后不重试，避免向调用方重复输出内容。
        retried = False
        while True:
            await client.threads.create(thread_id=thread_id, if_exists="do_nothing")
            emitted = False
            try:
                async for part in client.runs.stream(
                    thread_id,
                    "genesis_agent",
                    input=cast(Any, input_data),
                    stream_mode="messages",
                ):
                    for text in _extract_stream_text(part.data):
                        emitted = True
                        yield text
                return
            except NotFoundError:
                if retried or emitted:
                    raise
                logger.warning("LangGraph thread 丢失，重新创建后重试：thread_id=%s", thread_id)
                retried = True


def _extract_stream_text(data: object) -> list[str]:
    """兼容 LangGraph messages/v1 与 messages/v2 的序列化形态。"""
    if isinstance(data, dict):
        content = data.get("content")
        if isinstance(content, str):
            return [content]
        if isinstance(content, list):
            return [
                block["text"]
                for block in content
                if isinstance(block, dict) and isinstance(block.get("text"), str)
            ]
        return []
    if isinstance(data, (list, tuple)):
        texts: list[str] = []
        for item in data:
            texts.extend(_extract_stream_text(item))
        return texts
    return []


class AiProviderError(RuntimeError):
    """文本模型调用失败。"""
