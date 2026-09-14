"""Genesis 独立 Agent 的 LangGraph serve 入口。"""
from __future__ import annotations

from typing import Any, cast
from urllib.parse import urlparse

import httpx
from deepagents import create_deep_agent
from langchain.chat_models import init_chat_model
from langchain_core.language_models import BaseChatModel
from langgraph.graph.state import CompiledStateGraph

from genesis_agent.config import get_settings
from genesis_agent.runtime import BlogAgentRuntime
from genesis_agent.service import AgentPrompt
from genesis_agent.tools import build_blog_tools


_INTERRUPT_ON = {
    "create_draft": True,
    "update_post": True,
    "delete_post": True,
    "publish_post": True,
}


class YyapiAsyncTransport(httpx.AsyncBaseTransport):
    """移除被 yyapi WAF 错误拦截的 OpenAI SDK 诊断请求头。"""

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


def _build_graph() -> CompiledStateGraph[Any, Any, Any, Any]:
    settings = get_settings()
    configs = {
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
        "claude": (
            "anthropic", settings.text_claude_api_key,
            settings.text_claude_model, settings.text_claude_base_url,
        ),
    }

    def build_model(provider: str | None, model_name: str | None) -> BaseChatModel:
        selected_provider = provider or settings.text_provider
        if selected_provider not in configs:
            raise ValueError(f"不支持的 Agent Provider：{selected_provider}")

        native_provider, api_key, configured_model, base_url = configs[selected_provider]
        selected_model = model_name or configured_model
        if api_key is None or not api_key.get_secret_value().strip():
            raise RuntimeError(f"独立 Agent 未配置 {selected_provider} 的 API Key")
        if not selected_model:
            raise RuntimeError(f"独立 Agent 未配置 {selected_provider} 的模型名称")

        # yyapi 为 OpenAI-compatible 网关。即使页面选择的是 Gemini、Grok 或
        # Claude，也必须通过 OpenAI adapter 访问该网关；否则 SDK 会绕过网关，
        # 直接请求各厂商原生接口。
        is_compatible_gateway = urlparse(base_url).hostname == "www.yyapi.cloud"
        adapter_provider = "openai" if is_compatible_gateway else native_provider
        kwargs: dict[str, Any] = {
            "model": f"{adapter_provider}:{selected_model}",
            "api_key": api_key.get_secret_value(),
            "temperature": settings.text_temperature,
            "max_tokens": settings.text_max_tokens,
        }
        if is_compatible_gateway:
            normalized_base_url = base_url.rstrip("/")
            if not normalized_base_url.endswith("/v1"):
                normalized_base_url += "/v1"
            kwargs["base_url"] = normalized_base_url
            kwargs["http_async_client"] = httpx.AsyncClient(
                transport=YyapiAsyncTransport(),
                timeout=60,
            )
        elif selected_provider in ("openai", "grok"):
            kwargs["base_url"] = base_url
        return init_chat_model(**kwargs)

    tools = build_blog_tools()
    agent_cache: dict[tuple[str, str], Any] = {}

    def build_agent(provider: str | None, model_name: str | None) -> Any:
        selected_provider = provider or settings.text_provider
        if selected_provider not in configs:
            raise ValueError(f"不支持的 Agent Provider：{selected_provider}")
        selected_model = model_name or configs[selected_provider][2]
        cache_key = (selected_provider, selected_model or "")
        if cache_key not in agent_cache:
            agent_cache[cache_key] = create_deep_agent(
                model=build_model(provider, model_name),
                tools=tools,
                system_prompt=AgentPrompt.system_message_from_capabilities(),
                interrupt_on=_INTERRUPT_ON,
                name="genesis-blog-agent",
            )
        return agent_cache[cache_key]

    runtime = BlogAgentRuntime(
        build_model(None, None),
        tools,
        deep_agent_factory=build_agent,
    )
    return cast(CompiledStateGraph[Any, Any, Any, Any], runtime.graph)


graph = _build_graph()
