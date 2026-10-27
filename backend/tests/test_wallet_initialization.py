"""验证已有账户的钱包补齐幂等且不改变资金、流水或账单。"""

import importlib.util
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from genesis_api.database.session import engine


def test_existing_wallet_backfill_is_idempotent_and_preserves_balances() -> None:
    """在独立 schema 补齐旧账户，重复执行及回滚都不覆盖已有金额。"""
    if engine.dialect.name != "postgresql":
        pytest.skip("钱包补齐迁移需要现有 PostgreSQL")
    path = Path(__file__).parents[1] / "alembic/versions/20261027_28_initialize_wallets.py"
    spec = importlib.util.spec_from_file_location("initialize_wallets_migration", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    schema = "wallet_initialization_test_" + uuid4().hex
    first, second = uuid4(), uuid4()
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        with engine.begin() as connection:
            connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            connection.execute(text("CREATE TABLE users (id uuid PRIMARY KEY)"))
            connection.execute(text(
                "CREATE TABLE billing_wallets (user_id uuid PRIMARY KEY REFERENCES users(id),"
                " available numeric(20,8) NOT NULL, frozen numeric(20,8) NOT NULL)"
            ))
            connection.execute(text("INSERT INTO users VALUES (:first),(:second)"), {
                "first": first, "second": second,
            })
            connection.execute(text("INSERT INTO billing_wallets VALUES (:id,1.23,0.01)"), {
                "id": first,
            })
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
                migration.downgrade()
            assert connection.execute(text(
                "SELECT available,frozen FROM billing_wallets WHERE user_id=:id"
            ), {"id": first}).one() == (Decimal("1.23000000"), Decimal("0.01000000"))
            assert connection.execute(text(
                "SELECT available,frozen FROM billing_wallets WHERE user_id=:id"
            ), {"id": second}).one() == (Decimal(0), Decimal(0))
            assert connection.scalar(text("SELECT COUNT(*) FROM billing_wallets")) == 2
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
