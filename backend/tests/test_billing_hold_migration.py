"""在隔离 PostgreSQL schema 验证旧冻结退回，保留不可变资金凭证。"""

import importlib.util
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from genesis_api.billing.models import BillingOperation, WalletEntry
from genesis_api.billing.service import lock_wallet, post_entry, wallet_data
from genesis_api.blog import models as blog_models
from genesis_api.database.base import Base
from genesis_api.database.session import engine
from genesis_api.identity.models import User, UserRole


def test_release_historical_hold_once_without_rewriting_entries() -> None:
    """重复迁移仅退回一次，回滚不撤销已入账的解冻。"""
    if engine.dialect.name != "postgresql":
        pytest.skip("历史资金迁移要求现有 PostgreSQL")
    _ = blog_models
    path = Path(__file__).parents[1] / "alembic/versions/20261028_30_remove_budget_holds.py"
    spec = importlib.util.spec_from_file_location("remove_budget_holds", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    schema = "hold_migration_test_" + uuid4().hex
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated = engine.execution_options(schema_translate_map={None: schema})
    try:
        Base.metadata.create_all(isolated)
        with Session(isolated) as session:
            user = User(
                id=uuid4(), handle="migration-test", display_name="合成账户", role=UserRole.MEMBER
            )
            session.add(user)
            session.flush()
            wallet = lock_wallet(session, user.id)
            post_entry(
                session,
                wallet,
                key="seed",
                kind="credit",
                available=Decimal("1"),
                reason="合成充值",
            )
            operation = BillingOperation(
                user_id=user.id,
                source_id=uuid4(),
                kind="agent",
                provider="openai",
                model="test",
                mode="paid",
                status="pending",
                fingerprint="test",
                policy={},
                reserved=Decimal("0.08"),
                note="合成待核对说明",
            )
            session.add(operation)
            session.flush()
            post_entry(
                session,
                wallet,
                key="reserve-test",
                kind="reserve",
                available=Decimal("-0.08"),
                frozen=Decimal("0.08"),
                reason="历史合成冻结",
                operation_id=operation.id,
            )
            session.commit()
            user_id, operation_id = user.id, operation.id
        with engine.begin() as connection:
            connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
                migration.downgrade()
        with Session(isolated) as session:
            assert wallet_data(session, user_id) == {
                "currency": "CNY",
                "available": "1.00000000",
                "frozen": "0.00000000",
            }
            migrated = session.get(BillingOperation, operation_id)
            assert migrated is not None and migrated.reserved == 0
            assert migrated.policy["postpaid"] is True
            assert migrated.note == "合成待核对说明"
            entries = list(session.scalars(select(WalletEntry)))
            assert len(entries) == 3
            assert sum((e.available_delta for e in entries), Decimal(0)) == Decimal(1)
            assert sum((e.frozen_delta for e in entries), Decimal(0)) == Decimal(0)
            assert next(
                e for e in entries if e.event_key == "reserve-test"
            ).frozen_delta == Decimal("0.08")
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
