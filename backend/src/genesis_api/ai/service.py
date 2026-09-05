from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from genesis_api.ai.schemas import AiChatRequest
from genesis_api.core.config import Settings


class AiProviderError(RuntimeError):
    """文本模型调用失败。"""


class AiChatService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def stream(self, request: AiChatRequest) -> AsyncIterator[str]:
        provider = self.settings.text_provider
        api_key, base_url, configured_model = self._config(provider)
        if api_key is None or not api_key.get_secret_value().strip():
            raise AiProviderError(f"未配置 {provider} 的 API Key")
        model = request.model or configured_model
        if not model:
            raise AiProviderError(f"未配置 {provider} 的模型名称")

        payload = self._payload(request, model, provider)
        headers = self._headers(provider, api_key.get_secret_value())
        url = self._url(provider, base_url)
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        token = self._parse_line(provider, line)
                        if token:
                            yield token
            except httpx.HTTPError as exc:
                raise AiProviderError(f"{provider} 模型请求失败") from exc

    def _config(self, provider: str) -> tuple[Any, str, str | None]:
        if provider == "openai":
            return (
                self.settings.text_openai_api_key,
                self.settings.text_openai_base_url,
                self.settings.text_openai_model,
            )
        if provider == "grok":
            return (
                self.settings.text_grok_api_key,
                self.settings.text_grok_base_url,
                self.settings.text_grok_model,
            )
        return (
            self.settings.text_claude_api_key,
            self.settings.text_claude_base_url,
            self.settings.text_claude_model,
        )

    @staticmethod
    def _url(provider: str, base_url: str) -> str:
        base = base_url.rstrip("/")
        return f"{base}/messages" if provider == "claude" else f"{base}/chat/completions"

    @staticmethod
    def _headers(provider: str, api_key: str) -> dict[str, str]:
        if provider == "claude":
            return {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
        return {"authorization": f"Bearer {api_key}", "content-type": "application/json"}

    def _payload(self, request: AiChatRequest, model: str, provider: str) -> dict[str, Any]:
        system = (
            "你是 Genesis AI，服务于个人内容系统。优先给出可执行、清晰的中文回答。"
            "涉及修改文章时先给出修改结果和说明，不要擅自发布或删除内容。"
        )
        if request.context:
            context = request.context.model_dump(exclude_none=True)
            system += f"\n当前页面上下文：{json.dumps(context, ensure_ascii=False)}"
        messages = [{"role": item.role, "content": item.content} for item in request.messages]
        if provider == "claude":
            return {
                "model": model,
                "system": system,
                "messages": messages,
                "max_tokens": self.settings.text_max_tokens,
                "temperature": self.settings.text_temperature,
                "stream": True,
            }
        return {
            "model": model,
            "messages": [{"role": "system", "content": system}, *messages],
            "max_tokens": self.settings.text_max_tokens,
            "temperature": self.settings.text_temperature,
            "stream": True,
        }

    @staticmethod
    def _parse_line(provider: str, line: str) -> str | None:
        if not line or line.startswith(":"):
            return None
        data = line.removeprefix("data: ").strip()
        if data == "[DONE]":
            return None
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            return None
        if not isinstance(payload, dict):
            return None
        if provider == "claude":
            delta = payload.get("delta")
            if payload.get("type") == "content_block_delta" and isinstance(delta, dict):
                text = delta.get("text")
                return text if isinstance(text, str) else None
            return None
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            return None
        delta = choices[0].get("delta")
        if not isinstance(delta, dict):
            return None
        text = delta.get("content")
        return text if isinstance(text, str) else None
