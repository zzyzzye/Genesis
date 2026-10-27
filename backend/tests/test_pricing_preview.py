"""验证脱敏分组匹配、完整目录及只读价格预览，不调用真实模型。"""

from __future__ import annotations

import json
from decimal import Decimal

import httpx
import pytest
from pydantic import SecretStr

from genesis_api.billing.pricing import (
    PricingLookupError,
    TokenGroup,
    YyapiPricingService,
    mask_key,
    match_group,
)
from genesis_api.billing.pricing_rules import decimal_text, token_price_preview
from genesis_api.billing.schemas import ModelPricePreview
from genesis_api.core.config import Settings

KEY = "sk-abcdSyntheticKeyForTestsOnlywxyz"
EXPR = (
    'len <= 272000 ? tier("short", p * 2 + c * 12 + cr * 0.2 + cc * 2.5)'
    ' : tier("long", p * 4 + c * 18 + cr * 0.4 + cc * 5)'
)


def preview(row: dict[str, object], ratio: str = "0.2") -> ModelPricePreview:
    """通过测试固定的货币口径和分组，验证精确系数。"""
    return token_price_preview(
        row,
        group="codex-pro",
        group_ratio=Decimal(ratio),
        currency="CNY",
        currency_rate=Decimal(1),
        updated_at="2026-10-27T00:00:00+00:00",
    )


def test_mask_and_group_require_unique_match() -> None:
    """去掉 sk- 后匹配完整脱敏标识，绝不选取多条中的第一条。"""
    token = TokenGroup("abcd**********wxyz", "codex-pro", True, False)
    assert mask_key(KEY) == token.mask
    assert match_group((token,), KEY) == "codex-pro"
    for records in [(), (token, token)]:
        with pytest.raises(PricingLookupError):
            match_group(records, KEY)
    for token in [
        TokenGroup("abcd**********wxyz", "auto", True, True),
        TokenGroup("abcd**********wxyz", "codex-pro", False, False),
    ]:
        with pytest.raises(PricingLookupError):
            match_group((token,), KEY)
    with pytest.raises(PricingLookupError):
        mask_key("short")


def test_luna_tiers_apply_group_ratio_without_rounding_token_rates() -> None:
    result = preview({"billing_mode": "tiered_expr", "billing_expr": EXPR})
    assert result.status == "available"
    assert result.group_ratio == "0.2"
    prices = [(tier.input, tier.output, tier.cache_read, tier.cache_write) for tier in result.tiers]
    assert prices == [
        ("0.4", "2.4", "0.04", "0.5"),
        ("0.8", "3.6", "0.08", "1"),
    ]
    assert result.tiers[0].condition == "上下文 ≤ 272,000 Token"
    assert result.tiers[1].condition == "上下文 > 272,000 Token"


def test_cache_terms_do_not_overlap_and_small_prices_keep_precision() -> None:
    result = preview(
        {
            "billing_mode": "tiered_expr",
            "billing_expr": 'tier("base", p*3 + c*15 + cr*0.3 + cc*3.75 + cc1h*6)',
        },
        "0.00000001",
    )
    tier = result.tiers[0]
    assert tier.input == "0.00000003"
    assert tier.output == "0.00000015"
    assert tier.cache_read == "0.000000003"
    assert tier.cache_write == "0.0000000375"
    assert tier.cache_write_1h == "0.00000006"
    assert decimal_text(Decimal("1e3")) == "1000"
    assert decimal_text(Decimal("0.000")) == "0"


@pytest.mark.parametrize(
    "expression",
    [
        'tier("image", fixed(0.7)) * image_count',
        'hour() < 12 ? tier("a", p*1+c*2) : tier("b", p*2+c*4)',
        'tier("bad", p*1+c*2+u("seconds"))',
        'tier("bad", p*1+c*2-cc*3)',
        'tier("bad", p*1+c*2) + fixed(3)',
        'tier("bad", p*1+c*2+unknown*3)',
        '__import__("os").system("never run this")',
        'tier("bad", p*1)',
    ],
)
def test_unsupported_rules_never_display_partial_or_zero_prices(expression: str) -> None:
    result = preview({"billing_mode": "tiered_expr", "billing_expr": expression})
    assert result.status == "unavailable"
    assert result.tiers == []


def test_ratio_prices_currency_conversion_and_explicit_zero_discount() -> None:
    row: dict[str, object] = {
        "quota_type": 0,
        "model_ratio": "1.5",
        "completion_ratio": 5,
        "cache_ratio": "0.1",
    }
    result = token_price_preview(
        row,
        group="test",
        group_ratio=Decimal("0.2"),
        currency="CNY",
        currency_rate=Decimal("7"),
        updated_at="test",
    )
    assert result.tiers[0].input == "4.2"
    assert result.tiers[0].output == "21"
    assert result.tiers[0].cache_read == "0.42"
    assert preview(row, "0").tiers[0].input == "0"
    assert preview({"quota_type": 1, "model_price": 1}).status == "unavailable"
    assert preview({**row, "model_ratio": "NaN"}).status == "unavailable"
    variants = preview({**row, "billing_plugin_variants": [{"billing_expr": "different"}]})
    assert variants.status == "unavailable"


def settings(**updates: object) -> Settings:
    """所有访问值都是合成数据，不读取文件或输出认证配置。"""
    values: dict[str, object] = {
        "text_openai_api_key": SecretStr(KEY),
        "text_openai_base_url": "https://www.yyapi.cloud/v1",
        "yyapi_access_token": SecretStr("synthetic-console-access-token"),
        "yyapi_user_id": 123,
    }
    values.update(updates)
    return Settings.model_validate(values)


def transport(*, failure: str = "", requests: list[httpx.Request]) -> httpx.MockTransport:
    """第二页才放匹配令牌，避免实现只检查第一页。"""

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if failure == "auth":
            return httpx.Response(401, json={"message": "do not expose raw upstream errors"})
        if request.url.path == "/api/status":
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "data": {
                        "quota_display_type": "CNY",
                        "usd_exchange_rate": 1,
                    },
                },
            )
        if request.url.path == "/api/pricing":
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "group_ratio": {} if failure == "missing_ratio" else {"codex-pro": 0.2},
                    "data": [
                        {
                            "model_name": "gpt-5.6-luna",
                            "enable_groups": ["codex-pro"],
                            "billing_mode": "tiered_expr",
                            "billing_expr": EXPR,
                        }
                    ],
                },
            )
        assert request.url.path == "/api/token/"
        page = request.url.params["p"]
        row = {
            "id": 1 if page == "1" else 2,
            "status": 1,
            "expired_time": -1,
            "key": "xxxx**********zzzz" if page == "1" else "abcd**********wxyz",
            "group": "codex-pro",
            "cross_group_retry": False,
        }
        if failure == "collision":
            row["key"] = "abcd**********wxyz"
        if failure == "incomplete" and page != "1":
            return httpx.Response(200, json={"success": True, "data": {"total": 2, "items": []}})
        return httpx.Response(200, json={"success": True, "data": {"total": 2, "items": [row]}})

    return httpx.MockTransport(handler)


@pytest.mark.anyio
async def test_full_pagination_and_cache_keep_key_group_correlated() -> None:
    requests: list[httpx.Request] = []
    async with httpx.AsyncClient(transport=transport(requests=requests)) as client:
        service = YyapiPricingService(client)
        result = await service.for_models(settings(), "openai", ["gpt-5.6-luna", "unknown"])
        assert result["gpt-5.6-luna"].tiers[0].input == "0.4"
        assert result["unknown"].status == "unavailable"
        assert result["unknown"].group == "codex-pro"
        assert len(requests) == 4
        await service.for_models(settings(), "openai", ["gpt-5.6-luna"])
        assert len(requests) == 4
        unmatched = await service.for_models(
            settings(text_openai_api_key=SecretStr("sk-otherSyntheticKey0000")),
            "openai",
            ["gpt-5.6-luna"],
        )
        assert unmatched["gpt-5.6-luna"].status == "unavailable"
        assert len(requests) == 4
        await service.for_models(
            settings(yyapi_access_token=SecretStr("rotated-synthetic-token")),
            "openai",
            ["gpt-5.6-luna"],
        )
        assert len(requests) == 8
    for request in requests:
        assert request.url.params.get("token") is None
        if request.url.path != "/api/status":
            assert request.headers["New-Api-User"] == "123"


@pytest.mark.anyio
@pytest.mark.parametrize("failure", ["auth", "collision", "incomplete", "missing_ratio"])
async def test_failed_sync_does_not_guess_group_or_expose_authentication(failure: str) -> None:
    requests: list[httpx.Request] = []
    async with httpx.AsyncClient(transport=transport(failure=failure, requests=requests)) as client:
        result = await YyapiPricingService(client).for_models(settings(), "openai", ["test"])
    assert result["test"].status == "unavailable"
    encoded = json.dumps(result["test"].model_dump())
    assert "synthetic-console" not in encoded
    assert "abcd" not in encoded
    assert "raw upstream" not in encoded


@pytest.mark.anyio
async def test_free_and_unconfigured_channels_do_not_request_price_service() -> None:
    requests: list[httpx.Request] = []
    async with httpx.AsyncClient(transport=transport(requests=requests)) as client:
        service = YyapiPricingService(client)
        free = await service.for_models(settings(), "mimo", ["mimo-v2.6-flash"])
        assert free["mimo-v2.6-flash"].tiers[0].output == "0"
        for configured in [
            settings(yyapi_access_token=None),
            settings(yyapi_control_base_url="https://not-yyapi.example"),
            settings(yyapi_control_base_url="http://www.yyapi.cloud"),
            settings(text_openai_base_url="https://api.openai.com/v1"),
        ]:
            result = await service.for_models(configured, "openai", ["test"])
            assert result["test"].status == "unavailable"
    assert requests == []
