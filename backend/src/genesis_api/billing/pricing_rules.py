"""把受支持的上游文本定价规则转成单价预览，不执行上游表达式。"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Literal

from genesis_api.billing.schemas import ModelPricePreview, TokenPriceTier

_NUMBER = r"(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"
_VARIABLE = r"(?:cc1h|cr|cc|p|c)"
_TIER = r'tier\(\s*"(?P<name>[^"\\]{1,60})"\s*,\s*(?P<terms>[^()]+)\)'
_BRANCH = re.compile(r"\s*len\s*<=\s*(\d+)\s*\?\s*(.+)\s*:\s*(.+)\s*")


class UnsupportedPricing(ValueError):
    """规则不完整或超出本轮只读价格预览支持范围。"""


def decimal_value(value: object) -> Decimal:
    """拒绝布尔值、非有限数和负数，保留所有有效小数位。"""
    if not isinstance(value, (str, int, float, Decimal)) or isinstance(value, bool):
        raise UnsupportedPricing
    try:
        amount = Decimal(str(value))
    except InvalidOperation as exc:
        raise UnsupportedPricing from exc
    if not amount.is_finite() or amount < 0 or amount > Decimal("1e12"):
        raise UnsupportedPricing
    return amount


def decimal_text(value: Decimal) -> str:
    """API 不经过浮点数，零值也保留明确的字符串。"""
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _linear_tier(
    expression: str,
    condition: str | None,
) -> tuple[str, str | None, dict[str, Decimal]]:
    match = re.fullmatch(_TIER, expression.strip())
    if match is None:
        raise UnsupportedPricing
    values: dict[str, Decimal] = {}
    # 仅识别非负系数相加的线性项；函数、负号、额外条件都拒绝，绝不 eval。
    terms = match["terms"].strip()
    item = rf"(?:({_VARIABLE})\s*\*\s*({_NUMBER})|({_NUMBER})\s*\*\s*({_VARIABLE}))"
    matches = list(re.finditer(item, terms))
    cursor = 0
    for index, term in enumerate(matches):
        separator = terms[cursor : term.start()].strip()
        if separator != ("+" if index else ""):
            raise UnsupportedPricing
        variable, number = (term[1], term[2]) if term[1] else (term[4], term[3])
        values[variable] = values.get(variable, Decimal(0)) + decimal_value(number)
        cursor = term.end()
    if terms[cursor:].strip() or "p" not in values or "c" not in values:
        raise UnsupportedPricing
    return match["name"], condition, values


def _expression_tiers(expression: object) -> list[tuple[str, str | None, dict[str, Decimal]]]:
    if not isinstance(expression, str) or len(expression) > 4000:
        raise UnsupportedPricing
    branch = _BRANCH.fullmatch(expression)
    if branch:
        threshold = int(branch[1])
        if threshold < 1:
            raise UnsupportedPricing
        return [
            _linear_tier(branch[2], f"上下文 ≤ {threshold:,} Token"),
            _linear_tier(branch[3], f"上下文 > {threshold:,} Token"),
        ]
    return [_linear_tier(expression, None)]


def token_price_preview(
    row: dict[str, object],
    *,
    group: str,
    group_ratio: Decimal,
    currency: Literal["CNY", "USD"],
    currency_rate: Decimal,
    updated_at: str,
) -> ModelPricePreview:
    """用已匹配分组及站点货币口径生成文本价格预览。

    Args:
        row: 当前模型在 /api/pricing 中的记录。
        group: 调用 Key 唯一匹配到的固定分组。
        group_ratio: 该账号对此调用分组的有效倍率，允许显式零值。
        currency: 站点明确声明的显示货币。
        currency_rate: 规则基础货币转换到显示货币的系数。
        updated_at: 本次上游目录成功同步时间。

    Returns:
        精确字符串单价；缺失规则、按次、按秒及复杂动态条件显示待核对。
    """
    preview = ModelPricePreview(
        status="unavailable",
        group=group,
        group_ratio=decimal_text(group_ratio),
        currency=currency,
        updated_at=updated_at,
    )
    try:
        if row.get("billing_plugin_variants"):
            raise UnsupportedPricing
        mode = row.get("billing_mode")
        if mode == "tiered_expr":
            tiers = _expression_tiers(row.get("billing_expr"))
        elif (
            mode in (None, "", "ratio")
            and type(row.get("quota_type")) is int
            and row["quota_type"] == 0
        ):
            input_price = decimal_value(row.get("model_ratio")) * 2
            coefficients = {
                "p": input_price,
                "c": input_price * decimal_value(row.get("completion_ratio")),
            }
            for field, variable in [("cache_ratio", "cr"), ("create_cache_ratio", "cc")]:
                if row.get(field) is not None:
                    coefficients[variable] = input_price * decimal_value(row[field])
            tiers = [("standard", None, coefficients)]
        else:
            raise UnsupportedPricing
        factor = group_ratio * currency_rate
        prices = []
        for name, condition, values in tiers:

            def price(variable: str, coefficients: dict[str, Decimal] = values) -> str | None:
                if variable not in coefficients:
                    return None
                return decimal_text(coefficients[variable] * factor)

            prices.append(
                TokenPriceTier(
                    name=name,
                    condition=condition,
                    input=decimal_text(values["p"] * factor),
                    output=decimal_text(values["c"] * factor),
                    cache_read=price("cr"),
                    cache_write=price("cc"),
                    cache_write_1h=price("cc1h"),
                )
            )
        return preview.model_copy(update={"status": "available", "tiers": prices})
    except UnsupportedPricing:
        return preview.model_copy(
            update={
                "note": "该模型的计价规则暂不能可靠预览，请在上游核对价格。",
            }
        )
