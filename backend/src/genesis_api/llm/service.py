"""发现供应商可用模型，并用框架能力信息补充前端选择所需元数据。"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from pydantic import SecretStr

from genesis_api.core.config import Settings
from genesis_api.llm.capabilities import model_capabilities_for
from genesis_api.llm.models import AvailableModel, ProviderModels, ProviderName

logger = logging.getLogger(__name__)


class ModelDiscoveryError(RuntimeError):
    """模型列表获取失败。"""


class ModelDiscoveryService:
    """查询上游模型目录，失败时可回退到当前配置中的默认模型。"""

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        """绑定应用配置与可选 HTTP 客户端，不在构造时请求目录。

        Args:
            settings: 供应商连接、默认模型等配置。
            client: 可注入的异步客户端；提供时由调用方负责关闭。
        """
        self.settings = settings
        self._client = client

    async def list_models(self, provider: ProviderName) -> ProviderModels:
        """获取可用模型，将配置的默认模型置顶并附带思考档位。

        Args:
            provider: 已校验的供应商标识，用于选择地址和认证头。

        Returns:
            该供应商的模型列表；HTTP 或 JSON 解码失败时优先回退到默认模型。

        Raises:
            ModelDiscoveryError: 缺少 API Key、响应结构无效，
                或目录调用失败且未配置可回退的模型。
        """
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
                    models=self._with_capabilities(
                        provider,
                        [AvailableModel(
                            id=fallback_model,
                            name=fallback_model,
                        )],
                    ),
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
            models=self._with_capabilities(
                provider, self._prioritize_configured_model(provider, models)
            ),
        )

    def _with_capabilities(
        self, provider: ProviderName, models: list[AvailableModel]
    ) -> list[AvailableModel]:
        """通过统一能力入口补齐目录缺失字段，不让网关协议改变原生能力。

        Args:
            provider: 模型所属供应商，不使用基础地址推断能力。
            models: 已解析的模型列表。

        Returns:
            原列表；能力未知时档位字段为空，不猜测供应商支持范围。
        """
        for model in models:
            capabilities = model_capabilities_for(provider, model.id)
            profile = capabilities.profile
            # 上游目录的有效限制优先展示；目录省略时使用同一能力入口补充。
            if model.context_window is None:
                model.context_window = profile.get("max_input_tokens")
            if model.max_output_tokens is None:
                model.max_output_tokens = profile.get("max_output_tokens")
            model.reasoning_effort_levels = profile.get("reasoning_effort_levels")
            model.reasoning_effort_default = profile.get("reasoning_effort_default")
            model.thinking_modes = (
                list(capabilities.thinking_modes)
                if capabilities.thinking_modes is not None else None
            )
            model.thinking_mode_default = capabilities.thinking_mode_default
        return models

    def _provider_config(self, provider: ProviderName) -> tuple[SecretStr | None, str]:
        """读取供应商认证与地址配置，保持凭据为 SecretStr。

        Args:
            provider: 已通过字面量类型校验的供应商标识。

        Returns:
            可选 API Key 与基础地址；此处不检查 Key 是否已配置。
        """
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
        """返回指定供应商配置的默认模型，未配置时返回 None。"""
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
        """将配置的默认模型置顶，目录缺少该模型时补入一个记录。

        Args:
            provider: 默认模型所属的供应商。
            models: 已解析的目录模型列表。

        Returns:
            默认模型在首位的列表；未配置默认模型时返回原列表。
        """
        configured_model = self._provider_model(provider)
        if not configured_model or not configured_model.strip():
            return models

        matched = next((item for item in models if item.id == configured_model), None)
        default_model = matched or AvailableModel(
            id=configured_model,
            name=configured_model,
        )
        return [default_model, *(item for item in models if item.id != configured_model)]

    @staticmethod
    def _models_url(base_url: str) -> str:
        """生成模型目录地址，仅对已识别网关的根路径补充 /v1。

        Args:
            base_url: 配置的上游基础地址或完整 /models 地址。

        Returns:
            用于模型发现的 URL，不修改真实模型调用使用的配置地址。
        """
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
        """为目录请求生成供应商要求的认证头。

        Args:
            provider: 已校验的供应商标识。
            api_key: 仅用于 HTTP 请求的凭据，返回头不得写入日志或响应。

        Returns:
            认证及必要协议请求头。
        """
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
        """统一解析兼容目录与 Gemini 原生目录，跳过缺少模型标识的条目。

        Args:
            payload: 上游 JSON 对象，目录位于 data 或 models。
            provider: 用于处理原生名称及 MiMo 语音模型过滤。

        Returns:
            解析后的模型列表；保留上游有效长度，缺失值随后由统一能力入口补齐。

        Raises:
            ModelDiscoveryError: 目录字段不是列表。
        """
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
            context_window = (
                raw_model.get("context_window") or raw_model.get("context_length")
                or raw_model.get("inputTokenLimit")
            )
            if type(context_window) is not int or context_window <= 0:
                context_window = None
            max_output_tokens = (
                raw_model.get("max_output_tokens") or raw_model.get("outputTokenLimit")
            )
            if type(max_output_tokens) is not int or max_output_tokens <= 0:
                max_output_tokens = None
            models.append(
                AvailableModel(
                    id=model_id,
                    name=raw_model.get("display_name") or raw_model.get("name"),
                    created=raw_model.get("created"),
                    context_window=context_window,
                    max_output_tokens=max_output_tokens,
                )
            )
        return models
