"""在现有 Compose PostgreSQL 的独立临时 schema 验证并发冻结，不接触业务数据。"""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import SecretStr
from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker

from genesis_api.billing.models import PricePolicy, WalletEntry
from genesis_api.billing.service import (
    admit,
    channel_id,
    create_quote,
    lock_wallet,
    post_entry,
    units,
    wallet_data,
)
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.database.session import engine
from genesis_api.identity.models import User, UserRole


def test_postgres_concurrent_reservations_cannot_overspend() -> None:
    """两笔分别足额但合计超余额的订单只能有一笔成功冻结。"""
    if engine.dialect.name != "postgresql":
        pytest.skip("此事务竞争测试要求现有 PostgreSQL 服务")
    schema = "billing_test_" + uuid4().hex
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated = engine.execution_options(schema_translate_map={None: schema})
    factory = sessionmaker(isolated, expire_on_commit=False)
    try:
        Base.metadata.create_all(isolated)
        settings = Settings(
            text_openai_api_key=SecretStr("synthetic-concurrency"),
            text_openai_base_url="https://www.yyapi.cloud/v1",
        )
        with factory() as session:
            user = User(
                id=uuid4(),
                handle="isolated-billing-test",
                display_name="合成事务测试",
                role=UserRole.MEMBER,
            )
            session.add(user)
            session.flush()
            post_entry(
                session,
                lock_wallet(session, user.id),
                key="seed",
                kind="credit",
                available=units("0.01"),
                reason="合成入账",
            )
            session.add(
                PricePolicy(
                    kind="agent",
                    provider="openai",
                    model="test-model",
                    channel=channel_id(settings, "agent", "openai"),
                    max_request_units=100000,
                    max_input_bytes=10000,
                    max_output_tokens=4096,
                    quota_per_cny=500000,
                    evidence="合成价格上限",
                )
            )
            session.flush()
            quotes = [
                create_quote(
                    session,
                    user,
                    kind="agent",
                    provider="openai",
                    model="test-model",
                    settings=settings,
                ).id
                for _ in range(2)
            ]
            session.commit()
            user_id = user.id
        barrier = Barrier(2)

        def reserve(index: int) -> int:
            with factory() as session:
                current = session.get(User, user_id)
                assert current is not None
                barrier.wait(timeout=10)
                try:
                    admit(
                        session,
                        current,
                        source_id=uuid4(),
                        kind="agent",
                        provider="openai",
                        model="test-model",
                        quote_id=quotes[index],
                        settings=settings,
                    )
                    session.commit()
                    return 202
                except HTTPException as error:
                    session.rollback()
                    return error.status_code

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(reserve, range(2)))
        assert sorted(results) == [202, 402]
        with factory() as session:
            assert wallet_data(session, user_id)["available"] == "0.00200000"
            assert wallet_data(session, user_id)["frozen"] == "0.00800000"
            assert (
                len(list(session.scalars(select(WalletEntry).where(WalletEntry.kind == "reserve"))))
                == 1
            )
    finally:
        # schema 名只来源于本测试生成的 UUID；不会匹配或删除真实业务对象。
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
