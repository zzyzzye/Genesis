"""只读同步 YYAPI 令牌分组及价格目录；不创建报价、不改变计费准入。"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from genesis_api.billing.pricing_rules import (
    UnsupportedPricing,
    decimal_value,
    token_price_preview,
)
from genesis_api.billing.schemas import ModelPricePreview, TokenPriceTier
from genesis_api.billing.service import connection, is_yyapi
from genesis_api.core.config import Settings


class PricingLookupError(ValueError):
    """只携带可展示的固定错误文案，不包含响应正文或认证信息。"""


@dataclass(frozen=True)
class TokenGroup:
    """目录只在进程内保留脱敏标识及分组，不保存完整密钥。"""

    mask: str
    group: str
    active: bool
    automatic: bool


@dataclass(frozen=True)
class PricingCatalog:
    """一次完整同步的价格口径，禁止将半页令牌当成完整匹配集。"""

    tokens: tuple[TokenGroup, ...]
    models: dict[str, dict[str, Any]]
    group_ratios: dict[str, Any]
    currency: Literal["CNY", "USD"]
    currency_rate: Decimal
    updated_at: str
    quota_per_cny: int | None = None


def mask_key(value: str) -> str:
    """按已核实的 New API 规则去前缀后脱敏，仅用于本账号目录定位。"""
    key = value.strip().removeprefix("sk-")
    if len(key) <= 8:
        raise PricingLookupError("调用 Key 格式暂不支持自动匹配分组。")
    return key[:4] + "**********" + key[-4:]


def match_group(tokens: tuple[TokenGroup, ...], key: str) -> str:
    """完整目录中仅允许唯一命中，不根据匹配顺序或名称猜测。"""
    mask = mask_key(key)
    matches = [token for token in tokens if hmac.compare_digest(token.mask, mask)]
    if not matches:
        raise PricingLookupError("未找到当前调用 Key 的分组，请站长核对渠道所属账号。")
    if len(matches) != 1:
        raise PricingLookupError("调用 Key 的脱敏标识存在多个匹配，请站长核对渠道。")
    token = matches[0]
    if not token.active:
        raise PricingLookupError("当前调用 Key 已禁用或过期，请站长核对渠道。")
    if token.automatic or not token.group:
        raise PricingLookupError("当前 Key 使用自动或未明确的分组，暂不能预览唯一价格。")
    return token.group


class YyapiPricingService:
    """合并模型的只读目录请求，缓存按控制台凭据和地址隔离。"""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self.client = client
        self._cache: dict[str, tuple[float, PricingCatalog]] = {}
        self._lock = asyncio.Lock()

    async def catalog(self, settings: Settings) -> PricingCatalog:
        """读取用于管理员审核的完整目录，缺少凭据时不发送请求。"""
        secret = settings.yyapi_access_token
        if secret is None or not secret.get_secret_value().strip():
            raise PricingLookupError("价格服务尚未配置，暂无法预览。")
        return await self._catalog(settings, secret.get_secret_value())

    async def for_models(
        self, settings: Settings, provider: str, models: list[str]
    ) -> dict[str, ModelPricePreview]:
        """生成当前渠道每个模型的分组价格，失败时保留模型并明确未知。

        Args:
            settings: 只在发送请求时解包认证，禁止记录完整配置。
            provider: 当前文本模型供应商。
            models: 本轮已发现的模型 ID，不从价格表扩展可调用目录。

        Returns:
            仅含价格与固定错误说明的模型映射，不包含 Key 或控制台令牌。
        """
        if not models:
            return {}
        if provider == "mimo":
            free = ModelPricePreview(
                status="free",
                tiers=[TokenPriceTier(name="free", input="0", output="0")],
                note="MiMo 免费，不扣钱包余额。",
            )
            return dict.fromkeys(models, free)
        try:
            base, key = connection(settings, "agent", provider)
            if not is_yyapi(base):
                raise PricingLookupError("此渠道暂未接入价格预览。")
            catalog = await self.catalog(settings)
            group = match_group(catalog.tokens, key)
            ratio = decimal_value(catalog.group_ratios.get(group))
            previews = {}
            for model in models:
                row = catalog.models.get(model)
                groups = row.get("enable_groups") if row else None
                if (
                    row is None
                    or not isinstance(groups, list)
                    or (group not in groups and "all" not in groups)
                ):
                    previews[model] = ModelPricePreview(
                        status="unavailable",
                        group=group,
                        note="当前分组没有该模型的有效价格。",
                    )
                else:
                    previews[model] = token_price_preview(
                        row,
                        group=group,
                        group_ratio=ratio,
                        currency=catalog.currency,
                        currency_rate=catalog.currency_rate,
                        updated_at=catalog.updated_at,
                    )
            return previews
        except PricingLookupError as exc:
            note = str(exc)
        except UnsupportedPricing:
            note = "分组倍率或价格口径不完整，暂无法预览。"
        except HTTPException:
            note = "当前渠道尚未配置，暂无法预览价格。"
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            # httpx 异常可能包含带凭据的代理地址，不将原始异常交给前端或日志。
            note = "价格同步暂时失败，请稍后重新获取模型列表。"
        return {model: ModelPricePreview(status="unavailable", note=note) for model in models}

    async def _catalog(self, settings: Settings, token: str) -> PricingCatalog:
        base = settings.yyapi_control_base_url.rstrip("/")
        parsed = urlparse(base)
        if (
            parsed.scheme != "https"
            or not is_yyapi(base)
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path not in ("", "/")
            or parsed.port not in (None, 443)
        ):
            raise PricingLookupError("价格服务地址配置无效，请站长核对。")
        identity = hashlib.sha256(
            f"{base}\0{token}\0{settings.yyapi_user_id}".encode()
        ).hexdigest()
        async with self._lock:
            cached = self._cache.get(identity)
            if cached and time.monotonic() - cached[0] < 60:
                return cached[1]
            headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
            if settings.yyapi_user_id is not None:
                headers["New-Api-User"] = str(settings.yyapi_user_id)
            if self.client is not None:
                result = await self._load(self.client, base, headers)
            else:
                async with httpx.AsyncClient(
                    timeout=10,
                    trust_env=False,
                    follow_redirects=False,
                ) as client:
                    result = await self._load(client, base, headers)
            if len(self._cache) >= 8:
                self._cache.clear()
            self._cache[identity] = (time.monotonic(), result)
            return result

    @staticmethod
    async def _json(
        client: httpx.AsyncClient,
        url: str,
        headers: dict[str, str],
        params: dict[str, int] | None = None,
    ) -> dict[str, Any]:
        response = await client.get(url, headers=headers, params=params, follow_redirects=False)
        if response.status_code == 401:
            raise PricingLookupError("价格查询凭据无效或已过期，请站长更新。")
        if response.status_code == 403:
            raise PricingLookupError("价格查询权限不足，请站长核对渠道账号。")
        response.raise_for_status()
        if len(response.content) > 4_000_000:
            raise PricingLookupError("价格目录响应过大，暂无法完整核对。")
        data = json.loads(response.content, parse_float=Decimal)
        if not isinstance(data, dict) or data.get("success") is not True:
            raise PricingLookupError("价格目录响应无效，暂无法预览。")
        return data

    async def _load(
        self, client: httpx.AsyncClient, base: str, headers: dict[str, str]
    ) -> PricingCatalog:
        pricing, status, tokens = await asyncio.gather(
            self._json(client, f"{base}/api/pricing", headers),
            self._json(client, f"{base}/api/status", {}),
            self._tokens(client, base, headers),
        )
        data = status.get("data")
        if not isinstance(data, dict):
            raise PricingLookupError("站点价格货币口径缺失，暂无法预览。")
        currency = data.get("quota_display_type")
        if currency == "CNY":
            rate = decimal_value(data.get("usd_exchange_rate"))
            if rate == 0:
                raise UnsupportedPricing
        elif currency == "USD":
            rate = Decimal(1)
        else:
            raise PricingLookupError("站点货币暂不支持价格预览，请在上游核对。")
        rows, ratios = pricing.get("data"), pricing.get("group_ratio")
        if not isinstance(rows, list) or not isinstance(ratios, dict):
            raise PricingLookupError("定价表缺少模型或分组信息，暂无法预览。")
        models: dict[str, dict[str, Any]] = {}
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("model_name"), str):
                raise PricingLookupError("定价表模型记录无效，暂无法预览。")
            name = row["model_name"]
            if name in models:
                raise PricingLookupError("定价表存在重复模型，暂无法唯一核对。")
            models[name] = row
        return PricingCatalog(
            tokens=tokens,
            models=models,
            group_ratios=ratios,
            currency=currency,
            currency_rate=rate,
            updated_at=datetime.now(UTC).isoformat(),
            # 仅开放已经用实际账单核验过的 YYAPI 人民币额度口径。
            quota_per_cny=(
                500000
                if currency == "CNY"
                and rate == 1
                and data.get("quota_per_unit") == 500000
                and data.get("price") == 1
                else None
            ),
        )

    async def _tokens(
        self, client: httpx.AsyncClient, base: str, headers: dict[str, str]
    ) -> tuple[TokenGroup, ...]:
        records: dict[int, TokenGroup] = {}
        expected: int | None = None
        for page in range(1, 101):
            response = await self._json(
                client,
                f"{base}/api/token/",
                headers,
                {"p": page, "size": 100},
            )
            data = response.get("data")
            if not isinstance(data, dict):
                raise PricingLookupError("令牌目录响应无效，暂无法匹配分组。")
            total, items = data.get("total"), data.get("items")
            if type(total) is not int or total < 0 or not isinstance(items, list):
                raise PricingLookupError("令牌目录分页信息无效，暂无法完整匹配分组。")
            if expected is not None and total != expected:
                raise PricingLookupError("令牌目录正在变化，请重新读取价格。")
            expected = total
            for row in items:
                if not isinstance(row, dict):
                    raise PricingLookupError("令牌记录无效，暂无法匹配分组。")
                identifier, mask, group = row.get("id"), row.get("key"), row.get("group")
                if (
                    type(identifier) is not int
                    or identifier in records
                    or not isinstance(mask, str)
                    or not isinstance(group, str)
                    or re.fullmatch(r"[^*\s]{4}\*{10}[^*\s]{4}", mask) is None
                ):
                    raise PricingLookupError("令牌脱敏记录无法唯一核对，请站长检查。")
                expiry = row.get("expired_time", -1)
                active = (
                    row.get("status") == 1
                    and type(expiry) is int
                    and (expiry == -1 or expiry > time.time())
                )
                records[identifier] = TokenGroup(
                    mask=mask,
                    group=group,
                    active=active,
                    automatic=group == "auto" or row.get("cross_group_retry") is True,
                )
            if len(records) == total:
                return tuple(records.values())
            if not items or len(records) > total:
                break
        raise PricingLookupError("令牌目录未完整读取，暂无法可靠匹配分组。")


yyapi_pricing_service = YyapiPricingService()
