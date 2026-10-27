"""由管理员显式审核并启用聊天价格；启动服务不会自动开放或充值。"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from decimal import ROUND_CEILING, Decimal
from typing import Any
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid5

import httpx
from fastapi import HTTPException

from genesis_api.billing.pricing import YyapiPricingService
from genesis_api.billing.pricing_rules import decimal_value
from genesis_api.billing.reconciliation import billing_details
from genesis_api.billing.schemas import ModelPricePreview, PolicyRequest
from genesis_api.billing.service import (
    CALL_LIMIT,
    MONEY_QUANTUM,
    OUTPUT_LIMIT,
    channel_id,
    connection,
    money,
)
from genesis_api.core.config import Settings, get_settings
from genesis_api.llm.models import AvailableModel, ProviderName
from genesis_api.llm.service import ModelDiscoveryService


def policy_candidate(
    settings: Settings,
    provider: str,
    model: AvailableModel,
    price: ModelPricePreview,
    quota_per_cny: int | None,
) -> PolicyRequest:
    """以所有分档与缓存项目的保守上界计算单请求费用。

    输入按模型整个输入窗口计费，不把请求体字节数当成 Token 数。
    同一输入可能出现的缓存项全部相加，避免依赖缓存命中比例；输出
    使用所有分档最高费率，并为供应商整数额度舍入额外留一个额度。

    Args:
        settings: 用于绑定调用渠道，凭据不进入审核报告。
        provider: 当前目录对应的文本供应商。
        model: 包含明确输入窗口的实际目录项。
        price: 已匹配调用 Key 并换算成人民币的完整单价。
        quota_per_cny: 经状态接口及实际账单核验的每元额度。

    Returns:
        可重复提交的确定版本；此函数本身不开放模型或修改数据库。

    Raises:
        ValueError: 价格、额度口径或输入窗口尚不能确定可靠上界。
    """
    base, _ = connection(settings, "agent", provider)
    if urlsplit(base).hostname != "www.yyapi.cloud":
        raise ValueError("当前自动审核只适用于已核验的 YYAPI 文本渠道")
    if price.status != "available" or price.currency != "CNY" or not price.tiers:
        raise ValueError("缺少已核验的人民币文本价格")
    if quota_per_cny != 500000:
        raise ValueError("额度换算口径未通过实际账单核验")
    limit = model.context_window
    if type(limit) is not int or not 0 < limit <= 10_000_000:
        raise ValueError("模型没有可靠的输入窗口上限")
    output_limit = min(OUTPUT_LIMIT, model.max_output_tokens or OUTPUT_LIMIT)
    input_rate = max(
        sum(
            (
                decimal_value(value)
                for value in (tier.input, tier.cache_read, tier.cache_write, tier.cache_write_1h)
                if value is not None
            ),
            Decimal(0),
        )
        for tier in price.tiers
    )
    output_rate = max(decimal_value(tier.output) for tier in price.tiers)
    cost = (limit * input_rate + output_limit * output_rate) / 1_000_000
    quota = int((cost * quota_per_cny).to_integral_value(rounding=ROUND_CEILING)) + 1
    amount = (Decimal(quota) / quota_per_cny).quantize(MONEY_QUANTUM, rounding=ROUND_CEILING)
    evidence = json.dumps(
        {
            "audit": "YYAPI 目录、实际账单字段和额度换算核验；所有分档及缓存项目取上界",
            "input_tokens": limit,
            "input_rate_bound": str(input_rate),
            "output_tokens": output_limit,
            "output_rate_bound": str(output_rate),
            "quota_per_cny": quota_per_cny,
            "pricing_sha256": hashlib.sha256(
                price.model_dump_json(exclude={"updated_at", "note"}).encode()
            ).hexdigest(),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    identity = f"{channel_id(settings, 'agent', provider)}:{model.id}:{evidence}"
    return PolicyRequest(
        request_id=uuid5(NAMESPACE_URL, identity),
        kind="agent",
        provider=provider,
        model=model.id,
        max_request_amount=money(amount),
        max_input_bytes=1_000_000,
        max_output_tokens=output_limit,
        quota_per_cny=quota_per_cny,
        evidence=evidence,
        verified=True,
    )


async def verify_bill_source(settings: Settings, provider: str, quota_per_cny: int) -> None:
    """只读核验对应调用 Key 的账单接口，不发起生成或输出账单身份信息。"""
    base, key = connection(settings, "agent", provider)
    parsed = urlsplit(base)
    async with httpx.AsyncClient(timeout=20, trust_env=False, follow_redirects=False) as client:
        response = await client.get(
            f"{parsed.scheme}://{parsed.netloc}/api/log/token",
            headers={"Authorization": f"Bearer {key}"},
        )
        response.raise_for_status()
        payload = response.json()
    rows = payload.get("data") if payload.get("success") is True else None
    if not isinstance(rows, list):
        raise ValueError("实际账单接口格式未通过核验")
    verified = 0
    for row in rows:
        if isinstance(row, dict) and row.get("type") == 2 and row.get("request_id"):
            billing_details(row, quota_per_cny)
            verified += 1
    if not verified:
        raise ValueError("当前渠道尚无可核验的实际消费账单")


async def review_candidates(
    settings: Settings,
    providers: list[ProviderName],
) -> tuple[list[PolicyRequest], list[dict[str, str]]]:
    """收集可审核版本，某个模型未知不会使其他模型按猜测开放。

    Args:
        settings: 仅向已配置渠道发送目录和账单查询，不发起生成。
        providers: 需要分别核验调用 Key 的供应商。

    Returns:
        完整候选版本及跳过原因；不写入数据库，也不返回原始上游异常。
    """
    service = YyapiPricingService()
    catalog = await service.catalog(settings)
    candidates: list[PolicyRequest] = []
    skipped: list[dict[str, str]] = []
    for provider in providers:
        try:
            if catalog.quota_per_cny is None:
                raise ValueError("当前额度换算口径未核验")
            await verify_bill_source(settings, provider, catalog.quota_per_cny)
            models = (await ModelDiscoveryService(settings).list_models(provider)).models
            prices = await service.for_models(settings, provider, [m.id for m in models])
            for model in models:
                try:
                    candidates.append(
                        policy_candidate(
                            settings, provider, model, prices[model.id], catalog.quota_per_cny
                        )
                    )
                except (ValueError, HTTPException):
                    skipped.append(
                        {
                            "provider": provider,
                            "model": model.id,
                            "reason": "价格、模型输入上限或渠道口径尚未完整核验",
                        }
                    )
        except (httpx.HTTPError, ValueError, HTTPException, RuntimeError):
            skipped.append({"provider": provider, "reason": "当前渠道未通过目录及实账核验"})
    return candidates, skipped


def apply_candidates(candidates: list[PolicyRequest]) -> int:
    """复用管理员价格审核入口，追加版本与审计流水，不修改任何用户余额。"""
    from sqlalchemy import select

    from genesis_api.api.routes.billing import add_policy
    from genesis_api.billing.models import PricePolicy
    from genesis_api.blog import models as blog_models
    from genesis_api.database.session import SessionLocal
    from genesis_api.identity.models import User, UserRole

    # CLI 不启动应用路由树，需显式注册用户关系引用的博客模型。
    _ = blog_models
    with SessionLocal() as session:
        owners = list(session.scalars(select(User).where(User.role == UserRole.OWNER)))
        if len(owners) != 1:
            raise ValueError("需要唯一站长身份记录审核操作，请改用管理接口")
        for candidate in candidates:
            add_policy(candidate, owners[0], session)
        # 被人工暂停的确定版本不能借重复审核命令重新开放。
        return sum(
            bool(row and row.active)
            for candidate in candidates
            if (row := session.get(PricePolicy, candidate.request_id)) is not None
        )


async def run(apply: bool) -> dict[str, Any]:
    """先生成审核报告；只有显式 --apply 才写入价格版本。"""
    candidates, skipped = await review_candidates(
        get_settings(), ["openai", "claude", "grok", "gemini"]
    )
    report: dict[str, Any] = {
        "candidates": [
            {
                "provider": p.provider,
                "model": p.model,
                "max_request_amount": p.max_request_amount,
                "max_round_reserve": money(Decimal(p.max_request_amount) * CALL_LIMIT),
                "max_output_tokens": p.max_output_tokens,
            }
            for p in candidates
        ],
        "skipped": skipped,
    }
    if apply:
        report["applied"] = apply_candidates(candidates)
    return report


def main() -> None:
    """提供部署者可重复执行的审核命令，不打印原始异常或认证配置。"""
    parser = argparse.ArgumentParser(description="核验 YYAPI 聊天价格及冻结上限")
    parser.add_argument("--apply", action="store_true", help="显式启用已核验的聊天策略")
    options = parser.parse_args()
    try:
        print(json.dumps(asyncio.run(run(options.apply)), ensure_ascii=False, indent=2))
    except Exception:
        parser.exit(1, "聊天价格审核失败，请核对渠道、管理身份和账单接口。\n")


if __name__ == "__main__":
    main()
