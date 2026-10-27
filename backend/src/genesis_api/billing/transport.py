"""在既有 HTTP 客户端边界记录每次实际发送，不复制模型编排。"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from urllib.parse import urlsplit
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
    factory: Callable[[], Session] | None = None,
) -> Iterator[None]:
    """绑定业务任务的费用归属，退出时恢复外层上下文。"""
    token = _execution.set(Execution(source_id, settings, factory or SessionLocal))
    try:
        yield
    finally:
        _execution.reset(token)


def _before(execution: Execution, size: int, request: httpx.Request) -> UUID | None:
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
        if operation.mode == "paid" and operation.kind == "agent":
            _validate_chat_budget(operation, execution.settings, request)
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


def _validate_chat_budget(
    operation: BillingOperation, settings: Settings, request: httpx.Request
) -> None:
    """在实际发送边界核验型号和输出预算，子调用也不能改用更贵的模型。"""
    base, _ = connection(settings, "agent", operation.provider)
    parsed = urlsplit(base)
    if (
        request.url.scheme != parsed.scheme
        or request.url.host != parsed.hostname
        or request.url.port != parsed.port
        or request.url.path not in {"/v1/chat/completions", "/v1/responses"}
    ):
        raise RuntimeError("模型请求地址与已审核的聊天渠道不一致")
    try:
        body = json.loads(request.content)
    except (ValueError, UnicodeDecodeError) as exc:
        raise RuntimeError("无法核验模型请求的计费预算") from exc
    if not isinstance(body, dict) or body.get("model") != operation.model:
        raise RuntimeError("模型子调用与已确认的报价不一致")
    limits = [
        body[field]
        for field in ("max_tokens", "max_completion_tokens", "max_output_tokens")
        if field in body
    ]
    cap = min(4096, int(str(operation.policy.get("max_output_tokens", 4096))))
    if not limits or any(type(value) is not int or not 0 < value <= cap for value in limits):
        raise RuntimeError("模型请求缺少有效输出上限或超出已确认的预算")
    if body.get("n", 1) != 1 or body.get("best_of", 1) != 1:
        raise RuntimeError("当前付费聊天只允许单份输出")
    tools = body.get("tools", [])
    if not isinstance(tools, list) or any(
        not isinstance(tool, dict) or tool.get("type") != "function" for tool in tools
    ):
        raise RuntimeError("当前价格策略尚未核验供应商内置工具的附加费用")


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
    size = len(await request.aread())
    charge_id = await asyncio.to_thread(_before, execution, size, request)
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
