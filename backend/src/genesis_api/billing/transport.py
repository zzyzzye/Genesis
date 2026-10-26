"""在既有 HTTP 客户端边界记录每次实际发送，不复制模型编排。"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.billing.models import BillingOperation, UpstreamCharge
from genesis_api.billing.service import CALL_LIMIT, channel_id, connection, is_yyapi
from genesis_api.core.config import Settings
from genesis_api.database.session import SessionLocal


@dataclass(frozen=True)
class Execution:
    """每个执行协程独立持有账务归属，子任务继承相同预算。"""

    source_id: UUID
    settings: Settings
    factory: Callable[[], Session]


_execution: ContextVar[Execution | None] = ContextVar("billing_execution", default=None)


@contextmanager
def execution_context(
    source_id: UUID,
    settings: Settings,
    factory: Callable[[], Session] = SessionLocal,
) -> Iterator[None]:
    """绑定业务任务的费用归属，退出时恢复外层上下文。"""
    token = _execution.set(Execution(source_id, settings, factory))
    try:
        yield
    finally:
        _execution.reset(token)


def _before(execution: Execution, size: int) -> UUID | None:
    with execution.factory() as session:
        operation = session.scalar(
            select(BillingOperation)
            .where(BillingOperation.source_id == execution.source_id)
            .with_for_update()
        )
        if operation is None:
            # 部署前已存在的任务不追溯扣费。
            return None
        if operation.finished or operation.status not in {"running", "pending"}:
            raise RuntimeError("任务已结束，不能继续发起模型请求")
        limit = CALL_LIMIT if operation.kind == "agent" else 1
        if operation.mode != "platform" and operation.call_count >= limit:
            raise RuntimeError("本轮调用次数已达到预算上限")
        max_bytes = int(str(operation.policy.get("max_input_bytes", 1_000_000)))
        if operation.mode != "platform" and size > max_bytes:
            raise RuntimeError("输入超出已审核的计费上限，请减少上下文或参考素材")
        channel = channel_id(execution.settings, operation.kind, operation.provider)
        if operation.mode == "paid" and operation.policy.get("channel") != channel:
            raise RuntimeError("计费渠道已变化，本轮已停止，请等待已有请求核对")
        base, _ = connection(execution.settings, operation.kind, operation.provider)
        charge = UpstreamCharge(
            operation_id=operation.id,
            channel=channel,
            status="sending" if is_yyapi(base) else "unavailable",
        )
        operation.call_count += 1
        session.add(charge)
        session.commit()
        return charge.id


def _after(execution: Execution, charge_id: UUID, request_id: str | None) -> None:
    with execution.factory() as session:
        charge = session.get(UpstreamCharge, charge_id)
        if charge is not None:
            charge.request_id = request_id[:128] if request_id else None
            charge.status = "pending" if request_id else "unknown"
            session.commit()


async def before_request(request: httpx.Request) -> None:
    """发送前持久化意图，读取请求仅用于字节上限，不保存内容和认证头。"""
    execution = _execution.get()
    if execution is None or request.method != "POST":
        return
    # 图片 multipart 可能流式读取；实际构造后再发送，不重复请求上游。
    length = request.headers.get("content-length", "")
    size = int(length) if length.isdigit() else len(await request.aread())
    charge_id = await asyncio.to_thread(_before, execution, size)
    if charge_id is not None:
        request.extensions["genesis_billing_charge"] = charge_id


async def after_response(response: httpx.Response) -> None:
    """在响应正文消费前记录网关 ID，取消流或下载失败仍可核账。"""
    execution = _execution.get()
    charge_id = response.request.extensions.get("genesis_billing_charge")
    if execution is not None and isinstance(charge_id, UUID):
        await asyncio.to_thread(
            _after, execution, charge_id, response.headers.get("x-oneapi-request-id")
        )


def billing_hooks() -> dict[str, list[Callable[..., object]]]:
    """返回 httpx 原生事件钩子，不替代其网络和流式实现。"""
    return {"request": [before_request], "response": [after_response]}
