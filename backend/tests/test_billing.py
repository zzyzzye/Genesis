"""使用合成身份、隔离数据库和脱敏实账验证资金事务，不请求真实模型。"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from pydantic import SecretStr
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from genesis_api.ai.models import AiChatRun, AiChatRunStatus
from genesis_api.ai.runs import AiChatRunManager
from genesis_api.ai.schemas import AiChatRequest, AiMessage
from genesis_api.api.dependencies import get_current_user
from genesis_api.api.routes import ai as ai_routes
from genesis_api.api.routes import billing as routes
from genesis_api.billing.models import BillingOperation, PricePolicy, UpstreamCharge, WalletEntry
from genesis_api.billing.reconciliation import apply_rows, billing_details, reconcile_once
from genesis_api.billing.schemas import CreditRequest
from genesis_api.billing.service import (
    admit,
    channel_id,
    create_quote,
    finish_operation,
    lock_wallet,
    money,
    parse_amount,
    post_entry,
    wallet_data,
)
from genesis_api.billing.transport import after_response, before_request, execution_context
from genesis_api.core.config import Settings, get_settings
from genesis_api.database.base import Base
from genesis_api.database.session import get_session
from genesis_api.identity.models import User, UserRole


@pytest.fixture
def state() -> Any:
    """每个测试独占内存数据库和合成 Key。"""
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        text_openai_api_key=SecretStr("synthetic"),
        text_openai_base_url="https://www.yyapi.cloud/v1",
        text_openai_model="gpt-5.6-luna",
        text_mimo_api_key=SecretStr("synthetic"),
    )
    with factory() as session:
        user = User(
            id=uuid4(), handle="billing-member", display_name="账务测试", role=UserRole.MEMBER
        )
        owner = User(
            id=uuid4(), handle="billing-owner", display_name="管理测试", role=UserRole.OWNER
        )
        session.add_all([user, owner])
        session.commit()
        policy = PricePolicy(
            kind="agent",
            provider="openai",
            model="gpt-5.6-luna",
            channel=channel_id(settings, "agent", "openai"),
            max_request_amount=Decimal("0.001"),
            max_input_bytes=10000,
            max_output_tokens=4096,
            quota_per_cny=500000,
            evidence="合成上限",
        )
        session.add(policy)
        post_entry(
            session,
            lock_wallet(session, user.id),
            key="seed",
            kind="credit",
            available=parse_amount("1"),
            reason="测试入账",
            actor_id=owner.id,
        )
        session.commit()
        yield session, user, owner, settings, factory, policy
    engine.dispose()


def quote_and_admit(state: Any) -> BillingOperation:
    """使用真实服务完成一次已确认的付费冻结。"""
    session, user, _, settings, _, _ = state
    quote = create_quote(
        session, user, kind="agent", provider="openai", model="gpt-5.6-luna", settings=settings
    )
    session.commit()
    operation = admit(
        session,
        user,
        source_id=uuid4(),
        kind="agent",
        provider="openai",
        model="gpt-5.6-luna",
        quote_id=quote.id,
        settings=settings,
    )
    session.commit()
    return operation


def sample(request_id: str = "gateway-request", quota: int = 126, kind: int = 2) -> dict[str, Any]:
    """保留实际结算字段，去掉原账号、令牌名、渠道和个人信息。"""
    return {
        "request_id": request_id,
        "type": kind,
        "quota": quota,
        "created_at": 100,
        "model_name": "gpt-5.6-luna",
        "prompt_tokens": 4391,
        "completion_tokens": 7,
        "other": json.dumps(
            {
                "billing_formula": {
                    "base_quota": 631.4,
                    "final_quota": quota,
                    "effective_group_ratio": 0.2,
                },
                "matched_tier": "short",
                "cache_tokens": 4224,
                "model_price": 0,
                "model_ratio": 0,
                "response_model": {
                    "requested_model": "gpt-5.6-luna",
                    "upstream_model": "gpt-5.6-terra",
                    "returned_model": "gpt-5.6-terra",
                    "unneeded_debug": "synthetic-private-marker",
                },
            }
        ),
    }


@pytest.mark.parametrize("amount", ["0", "0.00000001", "0.000252", "10.12345678", "-0.01"])
def test_money_round_trip(amount: str) -> None:
    assert parse_amount(money(parse_amount(amount))) == parse_amount(amount)


@pytest.mark.parametrize("amount", ["NaN", "Infinity", "0.000000001", "wat", "1e1000"])
def test_money_rejects_invalid(amount: str) -> None:
    with pytest.raises(HTTPException):
        parse_amount(amount)


def test_real_bill_dynamic_cost_and_safe_projection() -> None:
    quota, cost, details = billing_details(sample(), 500000)
    assert quota == 126 and money(cost) == "0.00025200"
    assert details["matched_tier"] == "short" and details["cache_tokens"] == 4224
    assert details["response_model"]["upstream_model"] == "gpt-5.6-terra"
    assert "model_price" not in details and "username" not in details
    assert "unneeded_debug" not in details["response_model"]
    with pytest.raises(ValueError, match="不一致"):
        billing_details({**sample(), "quota": 127}, 500000)


@pytest.mark.parametrize("quota", [0, 126])
def test_gateway_error_only_releases_hold_with_explicit_zero_bill(state: Any, quota: int) -> None:
    """错误响应不等于免费，只有精确匹配的零额度错误实账允许退回冻结。"""
    session, user, _, _, _, _ = state
    operation = quote_and_admit(state)
    operation.call_count = 1
    session.add(
        UpstreamCharge(
            operation_id=operation.id,
            channel="test",
            request_id="gateway-request",
        )
    )
    finish_operation(session, operation.source_id)
    session.commit()
    row = sample(quota=quota, kind=5)
    apply_rows(session, "test", [row, row])
    session.commit()
    balance = wallet_data(session, user.id)
    if quota == 0:
        assert operation.status == "settled"
        assert balance["available"] == "1.00000000"
        assert balance["frozen"] == "0.00000000"
    else:
        assert operation.status == "pending"
        assert balance["frozen"] == "0.00800000"


def test_chat_policy_apply_is_idempotent_and_does_not_credit_wallets(
    state: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from genesis_api.billing.chat_policies import apply_candidates, policy_candidate
    from genesis_api.billing.schemas import ModelPricePreview, TokenPriceTier
    from genesis_api.llm.models import AvailableModel

    session, user, owner, settings, factory, _ = state
    monkeypatch.setattr("genesis_api.database.session.SessionLocal", factory)
    monkeypatch.setattr(routes, "get_settings", lambda: settings)
    candidate = policy_candidate(
        settings,
        "openai",
        AvailableModel(id="gpt-5.6-luna", name="Luna", created=None, context_window=1050000),
        ModelPricePreview(
            status="available",
            tiers=[
                TokenPriceTier(name="short", input="0.4", output="2.4"),
            ],
        ),
        500000,
    )
    assert apply_candidates([candidate]) == 1
    assert apply_candidates([candidate]) == 1
    session.expire_all()
    assert session.scalar(select(func.count()).select_from(PricePolicy)) == 2
    assert (
        session.scalar(
            select(func.count()).select_from(WalletEntry).where(WalletEntry.kind == "policy")
        )
        == 1
    )
    assert wallet_data(session, user.id)["available"] == "1.00000000"
    assert wallet_data(session, owner.id)["available"] == "0.00000000"
    row = session.get(PricePolicy, candidate.request_id)
    assert row is not None
    row.active = False
    session.commit()
    assert apply_candidates([candidate]) == 0


@pytest.mark.parametrize(
    "other", ["{", "[]", {"billing_formula": []}, {"billing_formula": {"final_quota": -1}}]
)
def test_invalid_bill_cannot_be_free(other: object) -> None:
    with pytest.raises(ValueError):
        billing_details({"other": other}, 500000)


def test_reserve_and_idempotent_actual_settlement(state: Any) -> None:
    session, user, _, settings, _, _ = state
    operation = quote_and_admit(state)
    assert operation.source_id is not None
    assert wallet_data(session, user.id) == {
        "currency": "CNY",
        "available": "0.99200000",
        "frozen": "0.00800000",
    }
    assert (
        admit(
            session,
            user,
            source_id=operation.source_id,
            kind="agent",
            provider="openai",
            model=operation.model,
            quote_id=operation.id,
            settings=settings,
        ).id
        == operation.id
    )
    charge = UpstreamCharge(operation_id=operation.id, channel="test", request_id="gateway-request")
    session.add(charge)
    operation.call_count = 1
    session.flush()
    finish_operation(session, operation.source_id)
    assert operation.status == "pending"
    apply_rows(session, "test", [sample()])
    session.commit()
    assert operation.status == "settled" and money(operation.charged) == "0.00025200"
    assert wallet_data(session, user.id)["available"] == "0.99974800"
    apply_rows(session, "test", [sample()])
    finish_operation(session, operation.source_id)
    session.commit()
    assert (
        session.scalar(
            select(func.count()).select_from(WalletEntry).where(WalletEntry.kind == "settle")
        )
        == 1
    )


def test_actual_overage_capped_and_policy_paused(state: Any) -> None:
    session, user, _, _, _, policy = state
    operation = quote_and_admit(state)
    session.add(
        UpstreamCharge(operation_id=operation.id, channel="test", request_id="gateway-request")
    )
    operation.call_count = 1
    session.flush()
    finish_operation(session, operation.source_id)
    apply_rows(session, "test", [sample(quota=1000000)])
    session.commit()
    assert operation.cost > operation.charged == operation.reserved
    assert not policy.active and "站点承担" in operation.note
    assert wallet_data(session, user.id)["frozen"] == "0.00000000"


def test_refund_is_idempotent_and_never_exceeds_original(state: Any) -> None:
    session, user, _, _, _, _ = state
    operation = quote_and_admit(state)
    session.add(
        UpstreamCharge(operation_id=operation.id, channel="test", request_id="gateway-request")
    )
    operation.call_count = 1
    session.flush()
    finish_operation(session, operation.source_id)
    apply_rows(session, "test", [sample()])
    session.commit()
    refund = sample(kind=6)
    apply_rows(session, "test", [refund, refund])
    session.commit()
    assert operation.charged == 0 and wallet_data(session, user.id)["available"] == "1.00000000"


@pytest.mark.parametrize(
    "case", ["missing", "expired", "changed", "used", "foreign", "paused", "channel"]
)
def test_quote_cannot_be_reused_or_changed(state: Any, case: str) -> None:
    session, user, owner, settings, _, policy = state
    quote = create_quote(
        session, user, kind="agent", provider="openai", model="gpt-5.6-luna", settings=settings
    )
    session.flush()
    quote_id: UUID | None = quote.id
    if case == "missing":
        quote_id = None
    if case == "expired":
        quote.created_at = datetime.now(UTC) - timedelta(minutes=6)
    if case == "changed":
        quote.fingerprint = "different"
    if case == "used":
        quote.status = "running"
    if case == "foreign":
        quote.user_id = owner.id
    if case == "paused":
        policy.active = False
    if case == "channel":
        settings.text_openai_api_key = SecretStr("rotated-synthetic")
    session.flush()
    with pytest.raises(HTTPException):
        admit(
            session,
            user,
            source_id=uuid4(),
            kind="agent",
            provider="openai",
            model="gpt-5.6-luna",
            quote_id=quote_id,
            settings=settings,
        )


def test_free_mimo_shares_concurrency_and_needs_no_money(state: Any) -> None:
    session, user, _, settings, _, _ = state
    wallet = lock_wallet(session, user.id)
    wallet.available = Decimal(0)
    session.commit()
    source = uuid4()
    free = admit(
        session,
        user,
        source_id=source,
        kind="agent",
        provider="mimo",
        model="mimo-v2.6-flash",
        quote_id=None,
        settings=settings,
    )
    session.commit()
    assert free.mode == "free" and free.reserved == 0
    with pytest.raises(HTTPException, match="MiMo"):
        admit(
            session,
            user,
            source_id=uuid4(),
            kind="agent",
            provider="mimo",
            model="mimo-v2.6-flash",
            quote_id=None,
            settings=settings,
        )
    finish_operation(session, source)
    session.commit()
    assert free.status == "settled"
    assert (
        admit(
            session,
            user,
            source_id=uuid4(),
            kind="agent",
            provider="mimo",
            model="mimo-v2.6-flash",
            quote_id=None,
            settings=settings,
        ).mode
        == "free"
    )


def test_owner_and_title_never_debit_user_wallet(state: Any) -> None:
    session, user, owner, settings, _, _ = state
    operation = admit(
        session,
        owner,
        source_id=uuid4(),
        kind="agent",
        provider="openai",
        model="gpt-5.6-luna",
        quote_id=None,
        settings=settings,
    )
    title = create_quote(
        session,
        user,
        kind="agent",
        provider="openai",
        model="gpt-5.6-luna",
        settings=settings,
        funded_by_platform=True,
    )
    assert operation.mode == title.mode == "platform"
    free_title = create_quote(
        session,
        user,
        kind="agent",
        provider="mimo",
        model=settings.text_mimo_model,
        settings=settings,
        funded_by_platform=True,
    )
    assert free_title.mode == "platform"
    free_title.source_id, free_title.status = uuid4(), "running"
    session.flush()
    free_run = admit(
        session,
        user,
        source_id=uuid4(),
        kind="agent",
        provider="mimo",
        model=settings.text_mimo_model,
        quote_id=None,
        settings=settings,
    )
    assert free_run.mode == "free"
    assert operation.reserved == title.reserved == 0


def test_ledger_idempotency_rejects_changed_credit_and_insufficient_funds(state: Any) -> None:
    session, user, owner, _, _, _ = state
    wallet = lock_wallet(session, user.id)
    post_entry(
        session,
        wallet,
        key="credit:test",
        kind="credit",
        available=Decimal("0.00000001"),
        reason="测试",
        actor_id=owner.id,
    )
    post_entry(
        session,
        wallet,
        key="credit:test",
        kind="credit",
        available=Decimal("0.00000001"),
        reason="测试",
        actor_id=owner.id,
    )
    with pytest.raises(HTTPException):
        post_entry(
            session,
            wallet,
            key="credit:test",
            kind="credit",
            available=Decimal("0.00000002"),
            reason="测试",
            actor_id=owner.id,
        )
    with pytest.raises(HTTPException):
        post_entry(
            session,
            wallet,
            key="negative",
            kind="correction",
            available=-parse_amount("2"),
            reason="测试",
        )


@pytest.mark.anyio
async def test_transport_persists_before_send_captures_header_and_enforces_shared_limit(
    state: Any,
) -> None:
    session, _, _, settings, factory, _ = state
    operation = quote_and_admit(state)
    assert operation.source_id is not None

    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, headers={"x-oneapi-request-id": str(uuid4())}, json={"id": "resp-other"}
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(respond),
        event_hooks={"request": [before_request], "response": [after_response]},
    ) as client:
        with execution_context(operation.source_id, settings, factory):
            for _ in range(8):
                await client.post(
                    "https://www.yyapi.cloud/v1/chat/completions",
                    json={"model": operation.model, "max_tokens": 64},
                )
            with pytest.raises(RuntimeError, match="调用次数"):
                await client.post("https://www.yyapi.cloud/v1/chat/completions", json={})
    session.expire_all()
    charges = list(session.scalars(select(UpstreamCharge)))
    assert len(charges) == 8 and all(
        c.request_id and not c.request_id.startswith("resp_") for c in charges
    )


@pytest.mark.anyio
async def test_reconciliation_delayed_bill_and_restart_preserve_hold(state: Any) -> None:
    session, user, _, settings, factory, _ = state
    operation = quote_and_admit(state)
    session.add(
        UpstreamCharge(
            operation_id=operation.id,
            channel=channel_id(settings, "agent", "openai"),
            request_id="gateway-request",
        )
    )
    operation.call_count = 1
    session.flush()
    finish_operation(session, operation.source_id)
    session.commit()
    rows: list[dict[str, Any]] = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"success": True, "data": rows})
        )
    ) as client:
        await reconcile_once(settings, factory, client)
        session.expire_all()
        assert wallet_data(session, user.id)["frozen"] == "0.00800000"
        operation = session.get(BillingOperation, operation.id)
        operation.next_check_at = None
        session.commit()
        rows.append(sample())
        await reconcile_once(settings, factory, client)
    session.expire_all()
    assert wallet_data(session, user.id)["available"] == "0.99974800"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "extra",
    [
        {"model": "unreviewed-expensive-model"},
        {"max_tokens": 8192},
        {"max_tokens": True},
        {"max_tokens": None},
        {"n": 2},
        {"tools": [{"type": "web_search"}]},
    ],
)
async def test_paid_http_request_cannot_bypass_model_or_output_budget(
    state: Any,
    extra: dict[str, Any],
) -> None:
    session, user, _, settings, factory, _ = state
    operation = quote_and_admit(state)
    assert operation.source_id is not None
    sent: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(respond),
        event_hooks={"request": [before_request], "response": [after_response]},
    ) as client:
        with execution_context(operation.source_id, settings, factory):
            with pytest.raises(RuntimeError):
                await client.post(
                    "https://www.yyapi.cloud/v1/chat/completions",
                    json={"model": operation.model, "max_tokens": 64, **extra},
                )
    assert sent == []
    session.expire_all()
    assert session.scalar(select(func.count()).select_from(UpstreamCharge)) == 0
    finish_operation(session, operation.source_id)
    session.commit()
    assert wallet_data(session, user.id) == {
        "currency": "CNY",
        "available": "1.00000000",
        "frozen": "0.00000000",
    }


@pytest.mark.anyio
async def test_native_agent_http_stream_to_actual_bill_settlement(
    state: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """真实 DeepAgents/LangChain 请求经过账务钩子，再用持久订单匹配延迟账单。"""
    from langgraph.checkpoint.memory import InMemorySaver

    import genesis_api.agent.runtime as runtime_module
    import genesis_api.billing.transport as transport_module
    from genesis_api.ai.service import AgentService

    session, user, _, settings, factory, policy = state
    policy.max_input_bytes = 200000
    session.commit()
    operation = quote_and_admit(state)
    assert operation.source_id is not None
    monkeypatch.setattr(transport_module, "SessionLocal", factory)
    # 运行时的方法内导入同一公共 SessionLocal；替换工厂不改变真实请求适配器。
    monkeypatch.setattr("genesis_api.database.session.SessionLocal", factory)
    sent: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        body = json.loads(request.content)
        assert body["model"] == operation.model
        assert request.url.path == "/v1/responses"
        assert body["max_output_tokens"] == 4096
        response = {
            "id": "resp-synthetic",
            "object": "response",
            "created_at": 100,
            "status": "completed",
            "model": operation.model,
            "output": [
                {
                    "type": "message",
                    "id": "msg-synthetic",
                    "role": "assistant",
                    "status": "completed",
                    "content": [{"type": "output_text", "text": "连接成功", "annotations": []}],
                }
            ],
            "usage": {"input_tokens": 4391, "output_tokens": 7, "total_tokens": 4398},
        }
        chunks = [
            {"type": "response.created", "response": {**response, "output": []}},
            {
                "type": "response.output_text.delta",
                "item_id": "msg-synthetic",
                "output_index": 0,
                "content_index": 0,
                "delta": "连接成功",
            },
            {
                "type": "response.output_text.done",
                "item_id": "msg-synthetic",
                "output_index": 0,
                "content_index": 0,
                "text": "连接成功",
            },
            {"type": "response.completed", "response": response},
        ]
        content = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
        return httpx.Response(
            200,
            headers={"x-oneapi-request-id": "gateway-request", "content-type": "text/event-stream"},
            content=content,
        )

    runtime = runtime_module.EmbeddedAgentRuntime()
    runtime._checkpointer = InMemorySaver()  # type: ignore[assignment]
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(respond),
        event_hooks=transport_module.billing_hooks(),
    ) as client:
        runtime._http_clients[True] = client
        request = AiChatRequest(
            surface="media",
            provider="openai",
            model=operation.model,
            actor_id=str(user.id),
            actor_role="member",
            billing_source_id=operation.source_id,
            messages=[AiMessage(role="user", content="请仅回答连接成功")],
        )
        output = [
            part
            async for part in AgentService(settings, runtime).stream(
                request, thread_id=str(uuid4())
            )
        ]
    assert "连接成功" in "".join(part for part in output if isinstance(part, str))
    assert len(sent) == 1
    session.expire_all()
    finish_operation(session, operation.source_id)
    session.commit()
    charge = session.scalar(select(UpstreamCharge))
    assert charge is not None and charge.request_id == "gateway-request"
    assert wallet_data(session, user.id)["frozen"] == "0.00800000"
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"success": True, "data": [sample()]})
        )
    ) as client:
        await reconcile_once(settings, factory, client)
        session.expire_all()
        operation = session.get(BillingOperation, operation.id)
        assert operation is not None and operation.status == "settled"
        operation.next_check_at = None
        session.commit()
        await reconcile_once(settings, factory, client)
    session.expire_all()
    assert wallet_data(session, user.id) == {
        "currency": "CNY",
        "available": "0.99974800",
        "frozen": "0.00000000",
    }
    assert (
        session.scalar(
            select(func.count()).select_from(WalletEntry).where(WalletEntry.kind == "settle")
        )
        == 1
    )


@pytest.mark.anyio
async def test_routes_permissions_credit_policy_and_quote(
    state: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    session, user, owner, settings, _, _ = state
    app = FastAPI()
    app.include_router(routes.router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_settings] = lambda: settings
    # 此路由通过既有配置函数读取，由测试替换模块引用，避免真实配置参与报价。
    with monkeypatch.context() as patch:
        patch.setattr(routes, "get_settings", lambda: settings)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1"
        ) as client:
            assert (await client.get("/billing/wallet")).json()["available"] == "1.00000000"
            assert (await client.get("/admin/billing/users")).status_code == 403
            assert (await client.get(f"/billing/operations/{uuid4()}")).status_code == 404
            quote = (
                await client.post(
                    "/billing/quotes", json={"kind": "agent", "model": "gpt-5.6-luna"}
                )
            ).json()
            assert quote["reserved_amount"] == "0.00800000"
            app.dependency_overrides[get_current_user] = lambda: owner
            credit = {
                "request_id": str(uuid4()),
                "user_id": str(user.id),
                "amount": "0.01",
                "reason": "已核实的测试充值",
            }
            for _ in range(2):
                assert (await client.post("/admin/billing/credits", json=credit)).status_code == 201
            assert wallet_data(session, user.id)["available"] == "1.01000000"
            assert (await client.get("/admin/billing/users?q=billing-member")).json()[0][
                "id"
            ] == str(user.id)
            policy = {
                "kind": "agent",
                "provider": "openai",
                "model": "another",
                "max_request_amount": "0.01",
                "max_input_bytes": 2000,
                "max_output_tokens": 4096,
                "quota_per_cny": 500000,
                "evidence": "测试审核",
                "verified": True,
            }
            assert (await client.post("/admin/billing/policies", json=policy)).status_code == 201
            assert len((await client.get("/admin/billing/policies")).json()) == 2
            assert (await client.get("/admin/billing/operations")).json()["items"] == []
            assert (await client.get("/billing/entries?page=1")).json()["items"][0][
                "kind"
            ] == "policy"


def test_manual_resolution_keeps_matched_cost_and_is_idempotent(state: Any) -> None:
    """人工核对不能抹掉已匹配费用，重复确认不能再次解冻。"""
    session, user, owner, _, _, _ = state
    operation = quote_and_admit(state)
    operation.finished, operation.status, operation.call_count = True, "review", 2
    session.add_all(
        [
            UpstreamCharge(
                operation_id=operation.id,
                channel="synthetic",
                status="settled",
                amount=Decimal("0.000252"),
            ),
            UpstreamCharge(operation_id=operation.id, channel="synthetic", status="unknown"),
        ]
    )
    session.commit()
    request = CreditRequest(
        request_id=uuid4(), user_id=user.id, amount="0.0001", reason="合成核对依据"
    )
    with pytest.raises(HTTPException, match="422"):
        routes.resolve(operation.id, request, owner, session)
    request.amount = "0.0003"
    first = routes.resolve(operation.id, request, owner, session)
    balance = wallet_data(session, user.id)
    assert routes.resolve(operation.id, request, owner, session) == first
    assert wallet_data(session, user.id) == balance
    assert operation.charged == Decimal("0.00030000")
    assert (
        session.scalar(
            select(func.count())
            .select_from(WalletEntry)
            .where(WalletEntry.event_key == f"resolve:{request.request_id}")
        )
        == 1
    )
    assert routes.admin_operation(operation.id, owner, session)["calls"]


def test_manual_resolution_preserves_ownership_and_finished_requirement(state: Any) -> None:
    session, user, owner, _, _, _ = state
    operation = quote_and_admit(state)
    request = CreditRequest(request_id=uuid4(), user_id=owner.id, amount="0", reason="核对")
    with pytest.raises(HTTPException, match="404"):
        routes.resolve(operation.id, request, owner, session)
    request.user_id = user.id
    with pytest.raises(HTTPException, match="409"):
        routes.resolve(operation.id, request, owner, session)


def test_svg_forces_configured_free_model_and_preserves_blog_permission(
    state: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    session, user, _, settings, _, _ = state
    monkeypatch.setattr(ai_routes, "get_settings", lambda: settings)
    request = AiChatRequest(
        surface="toolbox",
        purpose="svg",
        provider="openai",
        model="paid-model",
        messages=[AiMessage(role="user", content="画一个圆")],
    )
    prepared = ai_routes._prepare_request(
        request, current_user=user, current_user_role=user.role, session=session
    )
    assert prepared.provider == "mimo" and prepared.model == settings.text_mimo_model
    with pytest.raises(HTTPException, match="403"):
        ai_routes._prepare_request(
            request.model_copy(update={"surface": "studio", "purpose": "chat"}),
            current_user=user,
            current_user_role=user.role,
            session=session,
        )


def test_restart_does_not_replay_unknown_paid_request(state: Any) -> None:
    session, user, _, _, factory, _ = state
    operation = quote_and_admit(state)
    run = AiChatRun(
        id=operation.source_id,
        user_id=user.id,
        surface="media",
        provider="openai",
        model=operation.model,
        thread_id=str(uuid4()),
        request_payload={},
        status=AiChatRunStatus.RUNNING,
    )
    session.add_all(
        [run, UpstreamCharge(operation_id=operation.id, channel="synthetic", status="unknown")]
    )
    operation.call_count = 1
    session.commit()
    assert AiChatRunManager(factory)._recover_interrupted_runs_sync() == []
    session.expire_all()
    assert run.status == AiChatRunStatus.FAILED
    assert wallet_data(session, user.id)["frozen"] == "0.00800000"


def test_posted_entries_reject_update_and_delete(state: Any) -> None:
    session, _, _, _, _, _ = state
    entry = session.scalar(select(WalletEntry))
    entry.reason = "试图改写旧凭证"
    with pytest.raises(ValueError, match="不能修改或删除"):
        session.flush()
    session.rollback()
    session.delete(session.scalar(select(WalletEntry)))
    with pytest.raises(ValueError, match="不能修改或删除"):
        session.flush()
    session.rollback()


def test_new_channel_requires_new_price_review_even_for_same_model(state: Any) -> None:
    session, user, owner, settings, _, _ = state
    changed = settings.model_copy(
        update={"text_openai_api_key": SecretStr("another-synthetic-key")}
    )
    with pytest.raises(HTTPException, match="503"):
        create_quote(
            session, user, kind="agent", provider="openai", model="gpt-5.6-luna", settings=changed
        )
    platform = create_quote(
        session, owner, kind="agent", provider="openai", model="gpt-5.6-luna", settings=changed
    )
    assert platform.mode == "platform" and "quota_per_cny" not in platform.policy
