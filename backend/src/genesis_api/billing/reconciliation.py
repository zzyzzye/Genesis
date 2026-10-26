"""按渠道合并查询实账，延迟或未知结果不会自动解冻为免费。"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from genesis_api.billing.models import BillingOperation, UpstreamCharge
from genesis_api.billing.service import (
    SCALE,
    aware,
    channel_id,
    connection,
    is_yyapi,
    lock_wallet,
    post_entry,
    settle,
)
from genesis_api.core.config import Settings
from genesis_api.database.session import SessionLocal

logger = logging.getLogger(__name__)


def billing_details(row: dict[str, Any], quota_per_cny: int) -> tuple[int, int, dict[str, Any]]:
    """解析实账白名单，零价占位字段不参与计费，不执行供应商表达式。"""
    other = row.get("other", {})
    if isinstance(other, str):
        other = json.loads(other)
    if not isinstance(other, dict):
        raise ValueError("账单明细格式无效")
    formula = other.get("billing_formula", {})
    if not isinstance(formula, dict):
        raise ValueError("结算公式格式无效")
    quota = formula.get("final_quota", row.get("quota"))
    if type(quota) is not int or quota < 0 or quota_per_cny <= 0:
        raise ValueError("缺少有效结算额度")
    if "quota" in row and (type(row["quota"]) is not int or row["quota"] != quota):
        raise ValueError("结算额度与公式结果不一致，需要人工核对")
    amount = int(
        (Decimal(quota) * SCALE / quota_per_cny).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    )
    safe_formula = {
        k: formula[k]
        for k in (
            "mode",
            "base_quota",
            "base_group_ratio",
            "discount_ratio",
            "effective_group_ratio",
            "other_ratio",
            "surcharge_quota",
            "final_quota",
        )
        if k in formula and isinstance(formula[k], (str, int, float))
    }
    safe: dict[str, Any] = {"billing_formula": safe_formula}
    for key in (
        "billing_mode",
        "matched_tier",
        "cache_tokens",
        "expr_b64",
        "request_path",
        "billing_source",
        "billing_unit",
    ):
        if key in other:
            safe[key] = other[key]
    mapping = other.get("response_model")
    if isinstance(mapping, dict):
        safe["response_model"] = {
            key: mapping[key][:255]
            for key in ("requested_model", "upstream_model", "returned_model")
            if isinstance(mapping.get(key), str)
        }
    for key in ("model_name", "prompt_tokens", "completion_tokens", "group", "type"):
        if key in row:
            safe[key] = row[key]
    return quota, amount, safe


def apply_rows(session: Session, channel: str, rows: list[dict[str, Any]]) -> None:
    """精确匹配网关 ID，并在同一事务内写入证据与余额变动。"""
    request_ids = {str(row.get("request_id", "")) for row in rows} - {""}
    charges = list(
        session.scalars(
            select(UpstreamCharge).where(
                UpstreamCharge.channel == channel, UpstreamCharge.request_id.in_(request_ids)
            )
        )
    )
    by_request = {c.request_id: c for c in charges if c.request_id}
    touched: set[UUID] = set()
    for row in rows:
        charge = by_request.get(str(row.get("request_id", "")))
        if charge is None:
            continue
        operation = session.get(BillingOperation, charge.operation_id)
        if operation is None:
            continue
        lock_wallet(session, operation.user_id)
        session.refresh(operation, with_for_update=True)
        session.refresh(charge, with_for_update=True)
        try:
            quota, amount, details = billing_details(
                row, int(str(operation.policy["quota_per_cny"]))
            )
        except (ValueError, KeyError, TypeError, OverflowError):
            operation.note = "上游计费字段无效，保留冻结等待人工核对"
            continue
        if row.get("type") == 6:
            refund_id = f"{row.get('request_id')}:{row.get('created_at')}:{quota}"
            if refund_id in charge.refund_ids or charge.status != "settled":
                continue
            refund = min(amount, charge.units)
            charge.refund_ids = [*charge.refund_ids, refund_id]
            charge.units -= refund
            if operation.status == "settled":
                old_charged = operation.charged
                operation.cost = max(0, operation.cost - refund)
                operation.charged = (
                    min(operation.cost, operation.reserved) if operation.mode == "paid" else 0
                )
                if old_charged > operation.charged:
                    post_entry(
                        session,
                        lock_wallet(session, operation.user_id),
                        key=f"refund:{charge.id}:{refund_id}",
                        kind="refund",
                        available=old_charged - operation.charged,
                        reason="供应商退回已结算费用",
                        operation_id=operation.id,
                    )
        elif row.get("type") == 2 and charge.status != "settled":
            charge.quota, charge.units, charge.details = quota, amount, details
            charge.status = "settled"
        touched.add(operation.id)
        session.flush()
    for operation_id in touched:
        operation = session.get(BillingOperation, operation_id)
        if operation:
            settle(session, operation)


async def reconcile_once(
    settings: Settings,
    factory: Callable[[], Session] = SessionLocal,
    client: httpx.AsyncClient | None = None,
) -> None:
    """每个到期渠道只拉取一次近期账单；查不到则退避并保留冻结。"""
    now = datetime.now(UTC)
    with factory() as session:
        operations = list(
            session.scalars(
                select(BillingOperation)
                .where(
                    BillingOperation.mode != "free",
                    BillingOperation.provider != "mimo",
                    BillingOperation.source_id.is_not(None),
                    BillingOperation.status.in_(["running", "pending", "review", "settled"]),
                    or_(
                        BillingOperation.next_check_at.is_(None),
                        BillingOperation.next_check_at <= now,
                    ),
                )
                .order_by(
                    BillingOperation.next_check_at.asc().nullsfirst(), BillingOperation.created_at
                )
                .limit(500)
            )
        )
        due = [
            (o.id, o.kind, o.provider)
            for o in operations
            if o.next_check_at is None or aware(o.next_check_at) <= now
        ]
    groups: dict[str, tuple[str, str]] = {}
    for _, kind, provider in due:
        try:
            base, key = connection(settings, kind, provider)
            if is_yyapi(base):
                parsed = urlsplit(base)
                groups[channel_id(settings, kind, provider)] = (
                    f"{parsed.scheme}://{parsed.netloc}",
                    key,
                )
        except Exception:
            continue
    owned = client is None
    client = client or httpx.AsyncClient(timeout=20, trust_env=False)
    try:
        for channel, (base, key) in groups.items():
            try:
                response = await client.get(
                    base + "/api/log/token", headers={"Authorization": f"Bearer {key}"}
                )
                response.raise_for_status()
                data = response.json()
                if data.get("success") is not True or not isinstance(data.get("data"), list):
                    continue
                with factory() as session:
                    # 消费先于退款，接口记录顺序不影响首次结算。
                    rows = [r for r in data["data"] if isinstance(r, dict)]
                    apply_rows(session, channel, sorted(rows, key=lambda r: r.get("type") == 6))
                    session.commit()
            except (httpx.HTTPError, ValueError, TypeError):
                logger.warning("上游账单查询暂不可用，保留待结算状态")
        with factory() as session:
            for operation_id, _, _ in due:
                operation = session.get(BillingOperation, operation_id)
                if operation is None:
                    continue
                operation.retry_count += 1
                delay = (
                    3600
                    if operation.status == "settled"
                    else min(300, 5 * 2 ** min(operation.retry_count, 6))
                )
                operation.next_check_at = now + timedelta(seconds=delay)
                if (
                    operation.finished
                    and operation.status == "pending"
                    and operation.retry_count >= 8
                ):
                    operation.status = "review"
                    operation.note = "账单暂未匹配或请求结果未知，冻结保留，等待核对"
            session.commit()
    finally:
        if owned:
            await client.aclose()


async def reconcile_forever(settings: Settings) -> None:
    """随应用启动和退出运行，异常只记录通用原因，凭据不进入日志。"""
    while True:
        try:
            await reconcile_once(settings)
        except Exception:
            logger.warning("账单对账暂时失败，稍后重试")
        await asyncio.sleep(5)
