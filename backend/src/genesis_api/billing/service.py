"""钱包事务和预算准入；所有写入由调用方统一提交。"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.billing.models import (
    BillingOperation,
    PricePolicy,
    UpstreamCharge,
    Wallet,
    WalletEntry,
)
from genesis_api.core.config import Settings
from genesis_api.identity.models import User, UserRole

MONEY_QUANTUM = Decimal("0.00000001")
ZERO = Decimal("0.00000000")
CALL_LIMIT = 8
OUTPUT_LIMIT = 4096


def money(amount: Decimal) -> str:
    """将人民币元输出为固定八位字符串，避免经过浮点数。"""
    return f"{amount:.8f}"


def parse_amount(amount: str) -> Decimal:
    """精确解析金额，拒绝非有限数、超出精度及过大金额。"""
    try:
        value = Decimal(amount)
        if not value.is_finite() or abs(value) > 10**9:
            raise ValueError
        result = value.quantize(MONEY_QUANTUM)
        if result != value:
            raise ValueError
        return result
    except (ValueError, InvalidOperation, OverflowError) as exc:
        raise HTTPException(422, "金额无效，最多支持八位小数") from exc


def connection(settings: Settings, kind: str, provider: str) -> tuple[str, str]:
    """只供发送请求使用连接配置，调用方不得记录返回的凭据。"""
    if kind in {"image", "video"}:
        secret = getattr(settings, f"{kind}_api_key")
        base = getattr(settings, f"{kind}_api_base_url")
    else:
        secret = getattr(settings, f"text_{provider}_api_key", None)
        base = getattr(settings, f"text_{provider}_base_url", "")
    if secret is None or not secret.get_secret_value().strip():
        raise HTTPException(503, "该模型渠道尚未配置，请联系站长")
    return str(base).rstrip("/"), str(secret.get_secret_value())


def is_yyapi(base: str) -> bool:
    """仅允许已约定的 YYAPI 域名作为自动结算渠道。"""
    host = urlparse(base).hostname or ""
    return host == "yyapi.cloud" or host.endswith(".yyapi.cloud")


def channel_id(settings: Settings, kind: str, provider: str) -> str:
    """对连接做不可逆指纹，避免渠道换 Key 后误用旧账单。"""
    base, key = connection(settings, kind, provider)
    digest = hashlib.sha256(f"{base}\0{key}".encode()).hexdigest()
    return f"{kind}:{provider}:{digest[:40]}"


def lock_wallet(session: Session, user_id: UUID) -> Wallet:
    """先锁定身份行，串行化首次创建钱包和所有余额变更。"""
    user = session.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise HTTPException(404, "账户不存在")
    wallet = session.get(Wallet, user_id)
    if wallet is None:
        wallet = Wallet(user_id=user_id, available=ZERO, frozen=ZERO)
        session.add(wallet)
        session.flush()
    return wallet


def wallet_data(session: Session, user_id: UUID) -> dict[str, str]:
    """未创建钱包的用户视为零余额，查询不创建账务记录。"""
    wallet = session.get(Wallet, user_id)
    return {
        "currency": "CNY",
        "available": money(wallet.available if wallet else ZERO),
        "frozen": money(wallet.frozen if wallet else ZERO),
    }


def post_entry(
    session: Session,
    wallet: Wallet,
    *,
    key: str,
    kind: str,
    available: Decimal,
    frozen: Decimal = ZERO,
    reason: str,
    operation_id: UUID | None = None,
    actor_id: UUID | None = None,
) -> WalletEntry:
    """在已持锁事务中新增不可变凭证，阻止相同标识重放不同金额。"""
    existing = session.scalar(select(WalletEntry).where(WalletEntry.event_key == key))
    if existing is not None:
        if (
            existing.user_id,
            existing.available_delta,
            existing.frozen_delta,
            existing.reason,
            existing.actor_id,
        ) != (wallet.user_id, available, frozen, reason, actor_id):
            raise HTTPException(409, "操作标识已用于其他账务内容")
        return existing
    if wallet.available + available < 0 or wallet.frozen + frozen < 0:
        raise HTTPException(402, "可用余额不足，请联系站长充值")
    wallet.available += available
    wallet.frozen += frozen
    entry = WalletEntry(
        user_id=wallet.user_id,
        operation_id=operation_id,
        actor_id=actor_id,
        event_key=key,
        kind=kind,
        available_delta=available,
        frozen_delta=frozen,
        reason=reason,
    )
    session.add(entry)
    session.flush()
    return entry


def policy_for(
    session: Session, kind: str, provider: str, model: str, settings: Settings
) -> PricePolicy | None:
    """只复用同一域名及 Key 已审核的版本，渠道变化必须重新核验。"""
    try:
        current_channel = channel_id(settings, kind, provider)
    except HTTPException:
        return None
    return session.scalar(
        select(PricePolicy)
        .where(
            PricePolicy.kind == kind,
            PricePolicy.provider == provider,
            PricePolicy.model == model,
            PricePolicy.active.is_(True),
            PricePolicy.channel == current_channel,
        )
        .order_by(PricePolicy.created_at.desc(), PricePolicy.id.desc())
        .limit(1)
    )


def fingerprint(kind: str, provider: str, model: str, parameters: object) -> str:
    """将报价绑定到服务端实际生成参数，不包含凭据。"""
    return hashlib.sha256(
        json.dumps([kind, provider, model, parameters], sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def create_quote(
    session: Session,
    user: User,
    *,
    kind: str,
    provider: str,
    model: str,
    settings: Settings,
    parameters: object = None,
    funded_by_platform: bool = False,
) -> BillingOperation:
    """核验可用渠道和审核价格，只创建报价，不提前冻结资金。"""
    if funded_by_platform:
        mode = "platform"
    elif kind == "agent" and provider == "mimo":
        mode = "free"
    else:
        mode = "platform" if user.role is UserRole.OWNER else "paid"
    try:
        base, _ = connection(settings, kind, provider)
    except HTTPException:
        if mode != "platform":
            raise
        base = ""
    policy = policy_for(session, kind, provider, model, settings)
    if mode == "paid" and (not is_yyapi(base) or policy is None):
        raise HTTPException(503, "该模型尚未完成计费上限审核，暂不可付费使用")
    snapshot: dict[str, object] = {}
    if policy is not None:
        snapshot = {
            "id": str(policy.id),
            "max_request_amount": money(policy.max_request_amount),
            "max_input_bytes": policy.max_input_bytes,
            "max_output_tokens": policy.max_output_tokens,
            "quota_per_cny": policy.quota_per_cny,
        }
    if base:
        snapshot["channel"] = channel_id(settings, kind, provider)
    operation = BillingOperation(
        user_id=user.id,
        kind=kind,
        provider=provider,
        model=model,
        mode=mode,
        fingerprint=fingerprint(kind, provider, model, parameters),
        policy=snapshot,
        reserved=(
            policy.max_request_amount * (CALL_LIMIT if kind == "agent" else 1)
            if policy and mode == "paid"
            else ZERO
        ),
    )
    session.add(operation)
    session.flush()
    return operation


def operation_data(operation: BillingOperation) -> dict[str, Any]:
    """返回业务费用快照，不暴露上游凭据或用户身份。"""
    return {
        "id": str(operation.id),
        "kind": operation.kind,
        "provider": operation.provider,
        "model": operation.model,
        "mode": operation.mode,
        "status": operation.status,
        "reserved_amount": money(operation.reserved),
        "charged_amount": money(operation.charged),
        "cost_amount": money(operation.cost)
        if operation.mode != "free" and operation.status == "settled"
        else None,
        "currency": "CNY",
        "note": operation.note,
        "expires_at": (aware(operation.created_at) + timedelta(minutes=5)).isoformat(),
    }


def aware(value: datetime) -> datetime:
    """兼容测试数据库不保留时区的时间戳。"""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def admit(
    session: Session,
    user: User,
    *,
    source_id: UUID,
    kind: str,
    provider: str,
    model: str,
    quote_id: UUID | None,
    settings: Settings,
    parameters: object = None,
) -> BillingOperation:
    """在任务创建的同一事务中消费报价并冻结资金，重复任务返回原订单。"""
    wallet = lock_wallet(session, user.id)
    existing = session.scalar(
        select(BillingOperation).where(BillingOperation.source_id == source_id)
    )
    expected = fingerprint(kind, provider, model, parameters)
    if existing is not None:
        if existing.user_id != user.id or existing.fingerprint != expected:
            raise HTTPException(409, "请求标识已用于其他生成内容")
        return existing
    if kind == "agent" and provider == "mimo" and user.role is not UserRole.OWNER:
        active = session.scalar(
            select(BillingOperation.id)
            .where(
                BillingOperation.user_id == user.id,
                BillingOperation.mode == "free",
                BillingOperation.status == "running",
            )
            .limit(1)
        )
        if active is not None:
            raise HTTPException(409, "已有 MiMo 免费任务正在运行，请等待结束或停止该任务")
    if quote_id is None:
        if user.role is not UserRole.OWNER and not (kind == "agent" and provider == "mimo"):
            raise HTTPException(402, "请先确认本次生成的冻结金额")
        operation = create_quote(
            session,
            user,
            kind=kind,
            provider=provider,
            model=model,
            settings=settings,
            parameters=parameters,
        )
    else:
        found = session.scalar(
            select(BillingOperation)
            .where(BillingOperation.id == quote_id, BillingOperation.user_id == user.id)
            .with_for_update()
        )
        if found is None:
            raise HTTPException(404, "报价不存在")
        operation = found
        if operation.status != "quoted" or operation.fingerprint != expected:
            raise HTTPException(409, "报价已使用或生成参数已变化，请重新报价")
        if datetime.now(UTC) - aware(operation.created_at) > timedelta(minutes=5):
            raise HTTPException(409, "报价已过期，请重新获取")
    if operation.mode == "paid":
        if user.role is UserRole.OWNER or operation.policy.get("channel") != channel_id(
            settings, kind, provider
        ):
            raise HTTPException(409, "调用身份或渠道配置已更新，请重新报价")
        policy = session.get(PricePolicy, UUID(str(operation.policy["id"])))
        if policy is None or not policy.active:
            raise HTTPException(409, "模型价格策略已更新，请重新报价")
        post_entry(
            session,
            wallet,
            key=f"reserve:{operation.id}",
            kind="reserve",
            available=-operation.reserved,
            frozen=operation.reserved,
            reason="生成预算冻结",
            operation_id=operation.id,
        )
    elif operation.mode == "platform" and user.role is not UserRole.OWNER:
        raise HTTPException(409, "调用权限已更新，请重新报价")
    operation.source_id = source_id
    operation.status = "running"
    session.flush()
    return operation


def finish_operation(session: Session, source_id: UUID | None) -> None:
    """业务终态不等于零费用；只对明确未发送及免费任务即时结算。"""
    if source_id is None:
        return
    operation = session.scalar(
        select(BillingOperation).where(BillingOperation.source_id == source_id)
    )
    if operation is None:
        return
    lock_wallet(session, operation.user_id)
    session.refresh(operation, with_for_update=True)
    if operation.finished:
        return
    operation.finished = True
    operation.status = "pending"
    if operation.mode == "free" or operation.provider == "mimo" or operation.call_count == 0:
        settle(session, operation)


def settle(session: Session, operation: BillingOperation) -> None:
    """按实账汇总扣费并退还未用冻结；超额不转嫁用户。"""
    if operation.status == "settled" or not operation.finished:
        return
    charges = list(
        session.scalars(select(UpstreamCharge).where(UpstreamCharge.operation_id == operation.id))
    )
    if (
        operation.mode != "free"
        and operation.provider != "mimo"
        and any(c.status != "settled" for c in charges)
    ):
        return
    cost = sum((c.amount for c in charges), ZERO)
    operation.cost = cost
    if operation.mode == "paid":
        wallet = lock_wallet(session, operation.user_id)
        charged = min(cost, operation.reserved)
        post_entry(
            session,
            wallet,
            key=f"settle:{operation.id}",
            kind="settle",
            available=operation.reserved - charged,
            frozen=-operation.reserved,
            reason="按上游实账结算，退回未用冻结",
            operation_id=operation.id,
        )
        operation.charged = charged
        if cost > operation.reserved:
            operation.note = "上游费用超出冻结金额，差额由站点承担，已暂停该模型付费入口"
            for policy in session.scalars(
                select(PricePolicy).where(
                    PricePolicy.kind == operation.kind,
                    PricePolicy.provider == operation.provider,
                    PricePolicy.model == operation.model,
                )
            ):
                policy.active = False
    operation.status = "settled"


def source_billing(session: Session, source_id: UUID) -> dict[str, Any] | None:
    """取得业务对象的账务展示；旧任务没有订单时返回空。"""
    operation = session.scalar(
        select(BillingOperation).where(BillingOperation.source_id == source_id)
    )
    return operation_data(operation) if operation else None


def media_parameters(node: Any) -> dict[str, object]:
    """报价只绑定服务端保存的节点配置，包含提示词以阻止复用不同请求。"""
    return {
        "node_id": str(node.id),
        "generation": node.generation.model_dump(mode="json"),
        "duration_seconds": node.duration_seconds,
        "text": node.text,
    }
