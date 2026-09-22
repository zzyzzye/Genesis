from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from pydantic import SecretStr

from genesis_api.core.config import Settings
from genesis_api.llm.context_windows import context_window_for
from genesis_api.llm.models import AvailableModel, ProviderModels, ProviderName

logger = logging.getLogger(__name__)


class ModelDiscoveryError(RuntimeError):
    """模型列表获取失败。"""


class ModelDiscoveryService:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self._client = client

    async def list_models(self, provider: ProviderName) -> ProviderModels:
        api_key, base_url = self._provider_config(provider)
        if api_key is None or not api_key.get_secret_value().strip():
            raise ModelDiscoveryError(f"未配置 {provider} 的 API Key")

        client = self._client
        owns_client = client is None
        if owns_client:
            client = httpx.AsyncClient(timeout=15.0)
        assert client is not None

        try:
            response = await client.get(
                self._models_url(base_url),
                headers=self._headers(provider, api_key.get_secret_value()),
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            fallback_model = self._provider_model(provider)
            if fallback_model and fallback_model.strip():
                logger.warning(
                    "模型列表发现不可用，使用已配置的模型：provider=%s，error=%s",
                    provider,
                    type(exc).__name__,
                )
                return ProviderModels(
                    provider=provider,
                    models=[
                        AvailableModel(
                            id=fallback_model,
                            name=fallback_model,
                            context_window=context_window_for(provider, fallback_model),
                        )
                    ],
                )
            logger.exception("获取模型列表时调用上游服务失败：provider=%s", provider)
            raise ModelDiscoveryError(f"获取 {provider} 模型列表失败") from exc
        finally:
            if owns_client:
                await client.aclose()

        if not isinstance(payload, dict):
            raise ModelDiscoveryError("模型列表响应格式无效")
        models = self._parse_models(payload, provider)
        return ProviderModels(
            provider=provider,
            models=self._prioritize_configured_model(provider, models),
        )

    def _provider_config(self, provider: ProviderName) -> tuple[SecretStr | None, str]:
        if provider == "openai":
            return self.settings.text_openai_api_key, self.settings.text_openai_base_url
        if provider == "grok":
            return self.settings.text_grok_api_key, self.settings.text_grok_base_url
        if provider == "gemini":
            return self.settings.text_gemini_api_key, self.settings.text_gemini_base_url
        if provider == "mimo":
            return self.settings.text_mimo_api_key, self.settings.text_mimo_base_url
        return self.settings.text_claude_api_key, self.settings.text_claude_base_url

    def _provider_model(self, provider: ProviderName) -> str | None:
        if provider == "openai":
            return self.settings.text_openai_model
        if provider == "grok":
            return self.settings.text_grok_model
        if provider == "gemini":
            return self.settings.text_gemini_model
        if provider == "mimo":
            return self.settings.text_mimo_model
        return self.settings.text_claude_model

    def _prioritize_configured_model(
        self,
        provider: ProviderName,
        models: list[AvailableModel],
    ) -> list[AvailableModel]:
        """将已配置的默认模型置顶，即使网关模型目录暂未返回该模型。"""
        configured_model = self._provider_model(provider)
        if not configured_model or not configured_model.strip():
            return models

        matched = next((item for item in models if item.id == configured_model), None)
        default_model = matched or AvailableModel(
            id=configured_model,
            name=configured_model,
            context_window=context_window_for(provider, configured_model),
        )
        return [default_model, *(item for item in models if item.id != configured_model)]

    @staticmethod
    def _models_url(base_url: str) -> str:
        normalized = base_url.rstrip("/")
        if normalized.endswith("/models"):
            return normalized
        # yyapi 基于 New API：供应商调用可以使用根地址，但其统一模型目录
        # 位于 /v1/models。只在该网关的根地址上补充 /v1，不影响其余配置。
        parsed = urlparse(normalized)
        if parsed.hostname == "www.yyapi.cloud" and parsed.path.rstrip("/") == "":
            normalized = f"{normalized}/v1"
        return urljoin(f"{normalized}/", "models")

    @staticmethod
    def _headers(provider: ProviderName, api_key: str) -> dict[str, str]:
        if provider == "mimo":
            return {"api-key": api_key, "accept": "application/json"}
        if provider == "claude":
            return {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "accept": "application/json",
            }
        return {"authorization": f"Bearer {api_key}", "accept": "application/json"}

    @staticmethod
    def _parse_models(payload: dict[str, Any], provider: ProviderName) -> list[AvailableModel]:
        raw_models = payload.get("data", payload.get("models", []))
        if not isinstance(raw_models, list):
            raise ModelDiscoveryError("模型列表响应格式无效")

        models: list[AvailableModel] = []
        for raw_model in raw_models:
            if not isinstance(raw_model, dict):
                continue
            model_id = raw_model.get("id")
            if provider == "gemini" and not isinstance(model_id, str):
                native_name = raw_model.get("name")
                if isinstance(native_name, str):
                    model_id = native_name.removeprefix("models/")
            if not isinstance(model_id, str):
                continue
            # 官方目录同时包含语音识别/合成模型，不能用于文本 Agent。
            if provider == "mimo" and any(
                part in {"asr", "tts"} for part in model_id.split("-")
            ):
                continue
            context_window = raw_model.get("context_window") or raw_model.get("context_length")
            if not isinstance(context_window, int) or context_window <= 0:
                context_window = context_window_for(provider, model_id)
            models.append(
                AvailableModel(
                    id=model_id,
                    name=raw_model.get("display_name") or raw_model.get("name"),
                    created=raw_model.get("created"),
                    context_window=context_window,
                )
            )
        return models
