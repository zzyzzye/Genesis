from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager
from typing import Any, cast
from urllib.parse import urlparse

import httpx
from deepagents import create_deep_agent
from langchain.chat_models import init_chat_model
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from pydantic import SecretStr

from genesis_api.agent.mimo import ChatMiMo
from genesis_api.agent.prompt import AgentPrompt
from genesis_api.agent.tools import agent_invocation_context, build_blog_tools
from genesis_api.ai.schemas import AiChatRequest
from genesis_api.core.config import Settings


class YyapiAsyncTransport(httpx.AsyncBaseTransport):
    """移除会被兼容网关错误拦截的 OpenAI SDK 诊断请求头。"""

    def __init__(self) -> None:
        self._transport = httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        for header in tuple(request.headers):
            if header.lower().startswith("x-stainless-"):
                del request.headers[header]
        request.headers["user-agent"] = "Genesis-Agent/0.1"
        return await self._transport.handle_async_request(request)

    async def aclose(self) -> None:
        await self._transport.aclose()


class EmbeddedAgentRuntime:
    """管理进程内 LangGraph 图和 PostgreSQL checkpoint 生命周期。"""

    def __init__(self) -> None:
        self._checkpointer_context: AbstractAsyncContextManager[AsyncPostgresSaver] | None = None
        self._checkpointer: AsyncPostgresSaver | None = None
        self._graphs: dict[tuple[str, str], Any] = {}

    async def startup(self, settings: Settings) -> None:
        if self._checkpointer is not None:
            return
        context = AsyncPostgresSaver.from_conn_string(settings.resolved_postgres_uri)
        checkpointer = await context.__aenter__()
        try:
            await checkpointer.setup()
        except BaseException:
            await context.__aexit__(None, None, None)
            raise
        self._checkpointer_context = context
        self._checkpointer = checkpointer

    async def shutdown(self) -> None:
        context = self._checkpointer_context
        self._graphs.clear()
        self._checkpointer = None
        self._checkpointer_context = None
        if context is not None:
            await context.__aexit__(None, None, None)

    @staticmethod
    def _model_config(
        settings: Settings, provider: str
    ) -> tuple[str, SecretStr | None, str | None, str]:
        configs: dict[str, tuple[str, SecretStr | None, str | None, str]] = {
            "openai": (
                "openai", settings.text_openai_api_key,
                settings.text_openai_model, settings.text_openai_base_url,
            ),
            "grok": (
                "xai", settings.text_grok_api_key,
                settings.text_grok_model, settings.text_grok_base_url,
            ),
            "gemini": (
                "google_genai", settings.text_gemini_api_key,
                settings.text_gemini_model, settings.text_gemini_base_url,
            ),
            "mimo": (
                "openai", settings.text_mimo_api_key,
                settings.text_mimo_model, settings.text_mimo_base_url,
            ),
            "claude": (
                "anthropic", settings.text_claude_api_key,
                settings.text_claude_model, settings.text_claude_base_url,
            ),
        }
        if provider not in configs:
            raise ValueError(f"不支持的 Agent Provider：{provider}")
        return configs[provider]

    def _build_model(self, settings: Settings, provider: str, model: str) -> BaseChatModel:
        native_provider, api_key, _, base_url = self._model_config(settings, provider)
        if api_key is None or not api_key.get_secret_value().strip():
            raise RuntimeError(f"未配置 {provider} 的 API Key")
        is_compatible_gateway = urlparse(base_url).hostname == "www.yyapi.cloud"
        adapter_provider = "openai" if is_compatible_gateway else native_provider
        kwargs: dict[str, Any] = {
            "model": f"{adapter_provider}:{model}",
            "api_key": api_key.get_secret_value(),
            "temperature": settings.text_temperature,
            "max_tokens": settings.text_max_tokens,
        }
        if provider == "mimo":
            return ChatMiMo(
                model=model, api_key=api_key, base_url=base_url,
                default_headers={"api-key": api_key.get_secret_value()},
                temperature=settings.text_temperature,
                max_completion_tokens=settings.text_max_tokens,
                use_responses_api=False,
            )
        if is_compatible_gateway:
            normalized_base_url = base_url.rstrip("/")
            if not normalized_base_url.endswith("/v1"):
                normalized_base_url += "/v1"
            kwargs["base_url"] = normalized_base_url
            kwargs["http_async_client"] = httpx.AsyncClient(
                transport=YyapiAsyncTransport(), timeout=60
            )
        elif provider in ("openai", "grok"):
            kwargs["base_url"] = base_url
        return cast(BaseChatModel, init_chat_model(**kwargs))

    def _graph(self, settings: Settings, provider: str, model: str) -> Any:
        if self._checkpointer is None:
            raise RuntimeError("Agent runtime 尚未初始化")
        key = (provider, model)
        if key not in self._graphs:
            self._graphs[key] = create_deep_agent(
                model=self._build_model(settings, provider, model),
                tools=build_blog_tools(settings),
                system_prompt=AgentPrompt.system_message(),
                checkpointer=self._checkpointer,
                name="genesis-blog-agent",
            )
        return self._graphs[key]

    async def stream(
        self, request: AiChatRequest, settings: Settings, *, thread_id: str
    ) -> AsyncIterator[str]:
        if request.actor_id is None or request.actor_role is None:
            raise RuntimeError("Agent 调用缺少用户上下文")
        provider = request.provider or settings.text_provider
        _, _, configured_model, _ = self._model_config(settings, provider)
        model = request.model or configured_model
        if not model:
            raise RuntimeError(f"未配置 {provider} 的模型名称")
        graph = self._graph(settings, provider, model)
        messages: list[BaseMessage | dict[str, str]] = [
            SystemMessage(
                content=f"可信页面上下文：{request.context.model_dump() if request.context else {}}"
            ),
            *[message.model_dump() for message in request.messages],
        ]
        config = RunnableConfig(configurable={"thread_id": thread_id})
        graph_input: dict[str, object] | None = {"messages": messages}
        if request.resume_from_checkpoint and self._checkpointer is not None:
            checkpoint = await self._checkpointer.aget_tuple(config)
            if checkpoint is not None:
                graph_input = None
        with agent_invocation_context(request.actor_id, request.actor_role):
            async for message, _metadata in graph.astream(
                graph_input,
                config=config,
                stream_mode="messages",
                durability="sync",
            ):
                for text in _message_text(message):
                    yield text


def _message_text(message: object) -> list[str]:
    """只提取模型消息文本，忽略工具结果和元数据。"""
    if getattr(message, "type", None) not in ("ai", "AIMessageChunk"):
        return []
    content = getattr(message, "content", None)
    if isinstance(content, str):
        return [content] if content else []
    if isinstance(content, list):
        return [
            block["text"]
            for block in content
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        ]
    return []


embedded_agent_runtime = EmbeddedAgentRuntime()
