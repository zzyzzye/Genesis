"""核验聊天策略的费用上界、渠道绑定和不完整数据拒绝行为。"""

import json
from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

import genesis_api.billing.chat_policies as chat_policies
from genesis_api.billing.chat_policies import policy_candidate
from genesis_api.billing.schemas import ModelPricePreview, PolicyRequest, TokenPriceTier
from genesis_api.billing.service import SCALE
from genesis_api.core.config import Settings
from genesis_api.llm.models import AvailableModel


def candidate_data() -> tuple[Settings, AvailableModel, ModelPricePreview]:
    """使用已核验的 Grok 脱敏价格结构，不访问实际配置或网络。"""
    settings = Settings(
        text_grok_api_key=SecretStr("synthetic-policy-key"),
        text_grok_base_url="https://www.yyapi.cloud/v1",
    )
    model = AvailableModel(id="grok-4.7", name="Grok", created=None, context_window=500000)
    price = ModelPricePreview(
        status="available",
        group="grok",
        group_ratio="0.02",
        tiers=[
            TokenPriceTier(name="base", input="0.04", output="0.12", cache_read="0.01"),
            TokenPriceTier(name="long", input="0.08", output="0.24", cache_read="0.02"),
        ],
    )
    return settings, model, price


def test_policy_covers_full_input_cache_output_and_gateway_rounding() -> None:
    settings, model, price = candidate_data()
    result = policy_candidate(settings, "grok", model, price, 500000)
    assert result.max_request_amount == "0.05098600"
    assert Decimal(result.max_request_amount) * 8 == Decimal("0.40788800")
    basis = json.loads(result.evidence)
    assert basis["input_tokens"] == 500000
    assert basis["output_tokens"] == 4096
    assert Decimal(basis["input_rate_bound"]) == Decimal("0.10")
    assert "synthetic-policy-key" not in result.model_dump_json()
    assert int(Decimal(result.max_request_amount) * SCALE) % 200 == 0
    # 只刷新同步时间不会制造重复审核版本。
    changed_time = price.model_copy(update={"updated_at": "later"})
    assert policy_candidate(settings, "grok", model, changed_time, 500000) == result
    other = settings.model_copy(update={"text_grok_api_key": SecretStr("rotated-test-key")})
    assert policy_candidate(other, "grok", model, price, 500000).request_id != result.request_id


@pytest.mark.parametrize("reason", ["unknown_input", "missing_price", "currency", "quota", "host"])
def test_incomplete_policy_never_opens_a_paid_model(reason: str) -> None:
    settings, model, price = candidate_data()
    quota = 500000
    if reason == "unknown_input":
        model.context_window = None
    elif reason == "missing_price":
        price.status = "unavailable"
    elif reason == "currency":
        price.currency = "USD"
    elif reason == "quota":
        quota = 499999
    else:
        settings.text_grok_base_url = "https://another.yyapi.cloud/v1"
    with pytest.raises(ValueError):
        policy_candidate(settings, "grok", model, price, quota)


@pytest.mark.anyio
async def test_review_only_admits_models_with_complete_bounds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings, model, price = candidate_data()
    checked: list[str] = []

    class Prices:
        async def catalog(self, _: Settings) -> SimpleNamespace:
            return SimpleNamespace(quota_per_cny=500000)

        async def for_models(
            self,
            _: Settings,
            provider: str,
            models: list[str],
        ) -> dict[str, ModelPricePreview]:
            return dict.fromkeys(models, price)

    class Discovery:
        def __init__(self, _: Settings) -> None:
            pass

        async def list_models(self, provider: str) -> SimpleNamespace:
            if provider == "gemini":
                raise RuntimeError("synthetic unverified provider")
            return SimpleNamespace(
                models=[
                    model,
                    model.model_copy(
                        update={
                            "id": "missing-input-limit",
                            "context_window": None,
                        }
                    ),
                ]
            )

    async def verify(_: Settings, provider: str, quota: int) -> None:
        assert quota == 500000
        checked.append(provider)

    monkeypatch.setattr(chat_policies, "YyapiPricingService", Prices)
    monkeypatch.setattr(chat_policies, "ModelDiscoveryService", Discovery)
    monkeypatch.setattr(chat_policies, "verify_bill_source", verify)
    candidates, skipped = await chat_policies.review_candidates(settings, ["grok", "gemini"])
    assert [p.model for p in candidates] == ["grok-4.7"]
    assert len(skipped) == 2
    assert checked == ["grok", "gemini"]


@pytest.mark.anyio
async def test_preview_command_does_not_apply_until_explicitly_requested(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings, model, price = candidate_data()
    candidate = policy_candidate(settings, "grok", model, price, 500000)
    applied: list[object] = []

    async def review(*_: object) -> tuple[list[PolicyRequest], list[dict[str, str]]]:
        return [candidate], []

    def apply(candidates: list[PolicyRequest]) -> int:
        applied.extend(candidates)
        return len(candidates)

    monkeypatch.setattr(chat_policies, "review_candidates", review)
    monkeypatch.setattr(chat_policies, "apply_candidates", apply)
    report = await chat_policies.run(False)
    assert applied == []
    assert report["candidates"][0]["max_round_reserve"] == "0.40788800"
    assert (await chat_policies.run(True))["applied"] == 1
    assert applied == [candidate]
