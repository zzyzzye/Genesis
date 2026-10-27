"""当前用户账单及站长人工入账、价格审核和异常核对入口。"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from genesis_api.api.dependencies import CurrentUserDependency, OwnerDependency, SessionDependency
from genesis_api.billing.models import BillingOperation, PricePolicy, UpstreamCharge, WalletEntry
from genesis_api.billing.schemas import CreditRequest, PolicyRequest, QuoteRequest
from genesis_api.billing.service import (
    ZERO,
    channel_id,
    connection,
    create_quote,
    is_yyapi,
    lock_wallet,
    media_parameters,
    money,
    operation_data,
    parse_amount,
    post_entry,
    settle,
    wallet_data,
)
from genesis_api.core.config import get_settings
from genesis_api.identity.models import User
from genesis_api.media import service as media_service
from genesis_api.media.schemas import CanvasDocument

router = APIRouter(tags=["账务"])


def _details(session: Session, row: BillingOperation) -> dict[str, Any]:
    """仅投影当前订单的计费证据，不返回渠道凭据引用。"""
    return {
        **operation_data(row),
        "calls": [
            {
                "request_id": c.request_id,
                "status": c.status,
                "amount": money(c.amount),
                "details": c.details,
            }
            for c in session.scalars(
                select(UpstreamCharge).where(UpstreamCharge.operation_id == row.id)
            )
        ],
    }


@router.get("/billing/wallet")
def wallet(user: CurrentUserDependency, session: SessionDependency) -> dict[str, str]:
    """只读取当前登录账户的余额。"""
    return wallet_data(session, user.id)


@router.get("/billing/entries")
def entries(
    user: CurrentUserDependency,
    session: SessionDependency,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """分页读取不可变流水，不提供任意用户筛选参数。"""
    query = select(WalletEntry).where(WalletEntry.user_id == user.id)
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = session.scalars(
        query.order_by(WalletEntry.created_at.desc(), WalletEntry.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return {
        "total": total,
        "items": [
            {
                "id": str(r.id),
                "kind": r.kind,
                "amount": money(r.available_delta),
                "frozen_delta": money(r.frozen_delta),
                "reason": r.reason,
                "operation_id": str(r.operation_id) if r.operation_id else None,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }


@router.get("/billing/operations/{operation_id}")
def operation(
    operation_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, Any]:
    """费用详情按当前身份隔离，未归属订单统一返回 404。"""
    row = session.scalar(
        select(BillingOperation).where(
            BillingOperation.id == operation_id,
            BillingOperation.user_id == user.id,
            BillingOperation.mode.in_(("free", "paid")),
        )
    )
    if row is None:
        raise HTTPException(404, "账单不存在")
    return {
        **operation_data(row),
        "calls": [
            {
                "request_id": c.request_id,
                "status": c.status,
                "amount": money(c.amount),
                "details": c.details,
            }
            for c in session.scalars(
                select(UpstreamCharge).where(UpstreamCharge.operation_id == row.id)
            )
        ],
    }


@router.get("/billing/operations")
def my_operations(
    user: CurrentUserDependency, session: SessionDependency, page: int = Query(1, ge=1)
) -> dict[str, Any]:
    """分页列出个人免费和付费任务，站点成本只在管理员账务中展示。"""
    query = select(BillingOperation).where(
        BillingOperation.user_id == user.id,
        BillingOperation.source_id.is_not(None),
        BillingOperation.mode.in_(("free", "paid")),
    )
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = session.scalars(
        query.order_by(BillingOperation.created_at.desc()).offset((page - 1) * 20).limit(20)
    )
    return {"total": total, "items": [operation_data(row) for row in rows]}


@router.post("/billing/quotes", status_code=201)
def quote(
    data: QuoteRequest, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, Any]:
    """从真实保存节点取得媒体参数，报价不信任客户端声明的费用。"""
    parameters = None
    provider, model = data.provider, data.model
    if data.kind != "agent":
        if data.project_id is None or data.node_id is None:
            raise HTTPException(422, "请提供作品和节点标识")
        project = media_service.project_for(session, user.id, data.project_id)
        node = next(
            (
                n
                for n in CanvasDocument.model_validate(project.canvas).nodes
                if n.id == data.node_id
                and n.type == ("image_generation" if data.kind == "image" else "video")
            ),
            None,
        )
        if node is None:
            raise HTTPException(404, "生成节点不存在")
        model = node.generation.model
        provider = data.kind  # type: ignore[assignment]
        parameters = media_parameters(node)
    if not model.strip():
        raise HTTPException(422, "请先选择模型")
    row = create_quote(
        session,
        user,
        kind=data.kind,
        provider=provider,
        model=model,
        settings=get_settings(),
        parameters=parameters,
    )
    session.commit()
    return operation_data(row)


@router.get("/admin/billing/users")
def users(
    _: OwnerDependency, session: SessionDependency, q: str = Query("", max_length=100)
) -> list[dict[str, Any]]:
    """仅返回管理入账需要的账号资料，不读取认证凭据。"""
    query = (
        select(User)
        .where(User.handle.icontains(q, autoescape=True))
        .order_by(User.handle)
        .limit(30)
    )
    return [
        {
            "id": str(u.id),
            "handle": u.handle,
            "display_name": u.display_name,
            **wallet_data(session, u.id),
        }
        for u in session.scalars(query)
    ]


@router.post("/admin/billing/credits", status_code=201)
def credit(
    data: CreditRequest, owner: OwnerDependency, session: SessionDependency
) -> dict[str, str]:
    """确认后的人工充值或更正只新增流水，不能覆盖既有余额。"""
    amount = parse_amount(data.amount)
    if amount == 0 or not data.reason.strip():
        raise HTTPException(422, "请填写非零金额和入账原因")
    row = lock_wallet(session, data.user_id)
    post_entry(
        session,
        row,
        key=f"credit:{data.request_id}",
        kind="credit" if amount > 0 else "correction",
        available=amount,
        actor_id=owner.id,
        reason=data.reason.strip(),
    )
    session.commit()
    return wallet_data(session, data.user_id)


@router.get("/admin/billing/policies")
def policies(_: OwnerDependency, session: SessionDependency) -> list[dict[str, Any]]:
    """列出价格审核版本及暂停状态。"""
    rows = session.scalars(select(PricePolicy).order_by(PricePolicy.created_at.desc()).limit(200))
    return [
        {
            "id": str(p.id),
            "kind": p.kind,
            "provider": p.provider,
            "model": p.model,
            "max_request_amount": money(p.max_request_amount),
            "max_input_bytes": p.max_input_bytes,
            "max_output_tokens": p.max_output_tokens,
            "quota_per_cny": p.quota_per_cny,
            "active": p.active,
            "evidence": p.evidence,
        }
        for p in rows
    ]


@router.post("/admin/billing/policies", status_code=201)
def add_policy(
    data: PolicyRequest, owner: OwnerDependency, session: SessionDependency
) -> dict[str, str]:
    """新审核版本替代旧版本，旧报价失效，已冻结订单继续使用原快照。"""
    amount = parse_amount(data.max_request_amount)
    if amount <= 0 or not data.evidence.strip():
        raise HTTPException(422, "必须填写正数费用上限和审核依据")
    previous = session.get(PricePolicy, data.request_id)
    if previous is not None:
        if (
            previous.kind,
            previous.provider,
            previous.model,
            previous.max_request_amount,
            previous.max_input_bytes,
            previous.max_output_tokens,
            previous.quota_per_cny,
            previous.evidence,
        ) != (
            data.kind,
            data.provider,
            data.model,
            amount,
            data.max_input_bytes,
            data.max_output_tokens,
            data.quota_per_cny,
            data.evidence.strip(),
        ):
            raise HTTPException(409, "操作标识已用于其他价格审核")
        return {"id": str(previous.id)}
    if data.provider not in (
        {"openai", "grok", "gemini", "claude"} if data.kind == "agent" else {data.kind}
    ):
        raise HTTPException(422, "计费类型与渠道不匹配，MiMo 无需付费价格策略")
    settings = get_settings()
    base, _ = connection(settings, data.kind, data.provider)
    if not is_yyapi(base):
        raise HTTPException(422, "当前渠道尚未适配实账，不能启用付费价格策略")
    for old in session.scalars(
        select(PricePolicy)
        .where(
            PricePolicy.kind == data.kind,
            PricePolicy.provider == data.provider,
            PricePolicy.model == data.model,
        )
        .with_for_update()
    ):
        old.active = False
    row = PricePolicy(
        id=data.request_id,
        kind=data.kind,
        provider=data.provider,
        model=data.model,
        channel=channel_id(settings, data.kind, data.provider),
        max_request_amount=amount,
        max_input_bytes=data.max_input_bytes,
        max_output_tokens=data.max_output_tokens,
        quota_per_cny=data.quota_per_cny,
        evidence=data.evidence.strip(),
    )
    session.add(row)
    post_entry(
        session,
        lock_wallet(session, owner.id),
        key=f"policy:{data.request_id}",
        kind="policy",
        available=ZERO,
        actor_id=owner.id,
        reason=f"审核价格策略：{data.kind}/{data.provider}/{data.model}",
    )
    session.commit()
    return {"id": str(row.id)}


@router.get("/admin/billing/operations")
def admin_operations(
    _: OwnerDependency,
    session: SessionDependency,
    page: int = Query(1, ge=1),
    state: str = Query("", max_length=30),
) -> dict[str, Any]:
    """分页列出待核对订单和成本差异，不读取其他业务正文。"""
    query = select(BillingOperation).where(BillingOperation.source_id.is_not(None))
    if state:
        query = query.where(BillingOperation.status == state)
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = session.scalars(
        query.order_by(BillingOperation.created_at.desc()).offset((page - 1) * 20).limit(20)
    )
    return {
        "total": total,
        "items": [{**operation_data(o), "user_id": str(o.user_id)} for o in rows],
    }


@router.get("/admin/billing/operations/{operation_id}")
def admin_operation(
    operation_id: UUID, _: OwnerDependency, session: SessionDependency
) -> dict[str, Any]:
    """站长核对指定订单时只读取账务证据。"""
    row = session.get(BillingOperation, operation_id)
    if row is None:
        raise HTTPException(404, "账单不存在")
    return _details(session, row)


@router.post("/admin/billing/operations/{operation_id}/resolve")
def resolve(
    operation_id: UUID, data: CreditRequest, owner: OwnerDependency, session: SessionDependency
) -> dict[str, Any]:
    """人工核实异常费用后结算，附审计凭证，不允许给用户追加超额欠款。"""
    wallet = lock_wallet(session, data.user_id)
    audit = session.scalar(
        select(WalletEntry).where(WalletEntry.event_key == f"resolve:{data.request_id}")
    )
    if audit is not None:
        if (
            audit.operation_id != operation_id
            or audit.user_id != data.user_id
            or audit.reason != data.reason
        ):
            raise HTTPException(409, "操作标识已用于其他人工核对")
        previous = session.get(BillingOperation, operation_id)
        if previous is None or previous.cost != parse_amount(data.amount):
            raise HTTPException(409, "操作标识已用于其他核对金额")
        return operation_data(previous)
    row = session.scalar(
        select(BillingOperation)
        .where(BillingOperation.id == operation_id, BillingOperation.user_id == data.user_id)
        .with_for_update()
    )
    if row is None:
        raise HTTPException(404, "账单不存在")
    cost = parse_amount(data.amount)
    if not row.finished or row.status not in {"pending", "review"} or cost < 0:
        raise HTTPException(409, "只能核对已结束且未结算的订单")
    charges = list(
        session.scalars(select(UpstreamCharge).where(UpstreamCharge.operation_id == row.id))
    )
    known_cost = sum((c.amount for c in charges if c.status == "settled"), ZERO)
    if cost < known_cost:
        raise HTTPException(422, "核对金额不能低于已匹配的实账，请先核实退款或使用账务更正")
    for c in charges:
        if c.status != "settled":
            c.status, c.amount = "settled", ZERO
            c.details = {"manual_resolution": data.reason}
    if cost > known_cost:
        session.add(
            UpstreamCharge(
                operation_id=row.id,
                channel="manual",
                status="settled",
                amount=cost - known_cost,
                details={"manual_resolution": data.reason},
            )
        )
    post_entry(
        session,
        wallet,
        key=f"resolve:{data.request_id}",
        kind="review",
        available=ZERO,
        actor_id=owner.id,
        reason=data.reason,
        operation_id=row.id,
    )
    session.flush()
    settle(session, row)
    row.note = f"人工核对：{data.reason}" if cost <= row.reserved else row.note
    session.commit()
    return operation_data(row)
