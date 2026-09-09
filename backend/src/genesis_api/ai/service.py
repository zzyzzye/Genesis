from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any, cast

from langgraph_sdk import get_client

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
        }
        async for part in client.runs.stream(
            thread_id,
            "genesis_agent",
            input=cast(Any, input_data),
            stream_mode="messages",
        ):
            for text in _extract_stream_text(part.data):
                yield text


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
