from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

import httpx
from pydantic import SecretStr

from genesis_api.core.config import Settings
from genesis_api.llm.models import AvailableModel, ProviderModels, ProviderName


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
                self._models_url(provider, base_url),
                headers=self._headers(provider, api_key.get_secret_value()),
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ModelDiscoveryError(f"获取 {provider} 模型列表失败") from exc
        finally:
            if owns_client:
                await client.aclose()

        if not isinstance(payload, dict):
            raise ModelDiscoveryError("模型列表响应格式无效")
        return ProviderModels(provider=provider, models=self._parse_models(payload, provider))

    def _provider_config(self, provider: ProviderName) -> tuple[SecretStr | None, str]:
        if provider == "openai":
            return self.settings.text_openai_api_key, self.settings.text_openai_base_url
        if provider == "grok":
            return self.settings.text_grok_api_key, self.settings.text_grok_base_url
        if provider == "gemini":
            return self.settings.text_gemini_api_key, self.settings.text_gemini_base_url
        return self.settings.text_claude_api_key, self.settings.text_claude_base_url

    @staticmethod
    def _models_url(provider: ProviderName, base_url: str) -> str:
        normalized = base_url.rstrip("/")
        if normalized.endswith("/models"):
            return normalized
        if provider in ("openai", "grok", "gemini", "claude") and not normalized.endswith("/v1"):
            normalized = f"{normalized}/v1"
        return urljoin(f"{normalized}/", "models")

    @staticmethod
    def _headers(provider: ProviderName, api_key: str) -> dict[str, str]:
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
            models.append(
                AvailableModel(
                    id=model_id,
                    name=raw_model.get("display_name") or raw_model.get("name"),
                    created=raw_model.get("created"),
                    context_window=raw_model.get("context_window")
                    or raw_model.get("context_length"),
                )
            )
        return models
