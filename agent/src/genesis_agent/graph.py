"""Genesis 独立 Agent 的 LangGraph serve 入口。"""
from __future__ import annotations

from typing import Any, cast

from langchain.chat_models import init_chat_model
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph.state import CompiledStateGraph

from genesis_agent.config import get_settings
from genesis_agent.runtime import BlogAgentRuntime
from genesis_agent.tools import build_blog_tools


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
    provider, api_key, model_name, base_url = configs[settings.text_provider]
    if api_key is None or not api_key.get_secret_value().strip():
        raise RuntimeError(f"独立 Agent 未配置 {settings.text_provider} 的 API Key")
    if not model_name:
        raise RuntimeError(f"独立 Agent 未配置 {settings.text_provider} 的模型名称")
    kwargs: dict[str, Any] = {
        "model": f"{provider}:{model_name}",
        "api_key": api_key.get_secret_value(),
        "temperature": settings.text_temperature,
        "max_tokens": settings.text_max_tokens,
    }
    if settings.text_provider in ("openai", "grok"):
        kwargs["base_url"] = base_url
    model = init_chat_model(**kwargs)
    checkpointer_context = PostgresSaver.from_conn_string(settings.database_url)
    checkpointer = checkpointer_context.__enter__()
    checkpointer.setup()
    runtime = BlogAgentRuntime(model, build_blog_tools(), checkpointer)
    return cast(CompiledStateGraph[Any, Any, Any, Any], runtime.graph)

graph = _build_graph()
