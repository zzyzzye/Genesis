"""在现有 PostgreSQL 的独立 schema 验证金额迁移往返，不触碰实际钱包。"""

import importlib.util
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from genesis_api.database.session import engine


def test_postgres_decimal_migration_preserves_money_and_quote_snapshots() -> None:
    """验证 ¥5、最小金额、负流水、历史报价及上游额度均可无损往返。"""
    if engine.dialect.name != "postgresql":
        pytest.skip("金额迁移往返要求现有 PostgreSQL")
    path = Path(__file__).parents[1] / "alembic/versions/20261027_27_billing_decimal_cny.py"
    spec = importlib.util.spec_from_file_location("decimal_cny_migration", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    schema = "decimal_migration_test_" + uuid4().hex
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        with engine.begin() as connection:
            connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            statements = [
                "CREATE TABLE billing_wallets (available bigint, frozen bigint)",
                "INSERT INTO billing_wallets VALUES (500000000,800000),(1,0)",
                "CREATE TABLE billing_entries (available_delta bigint, frozen_delta bigint)",
                "INSERT INTO billing_entries VALUES (-25200,-800000)",
                "CREATE TABLE billing_price_policies (max_request_units bigint)",
                "INSERT INTO billing_price_policies VALUES (100000)",
                "CREATE TABLE billing_upstream_charges (units bigint, quota bigint)",
                "INSERT INTO billing_upstream_charges VALUES (25200,126)",
                "CREATE TABLE billing_operations (reserved bigint, charged bigint, cost bigint,"
                " policy json)",
                "INSERT INTO billing_operations VALUES (800000,25200,25200,"
                ' \'{"max_request_units": 100000, "quota_per_cny": 500000}\')',
            ]
            for statement in statements:
                connection.execute(text(statement))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                assert list(
                    connection.execute(
                        text("SELECT available,frozen FROM billing_wallets ORDER BY available DESC")
                    )
                ) == [
                    (Decimal("5.00000000"), Decimal("0.00800000")),
                    (Decimal("0.00000001"), Decimal("0.00000000")),
                ]
                assert connection.execute(
                    text("SELECT available_delta,frozen_delta FROM billing_entries")
                ).one() == (Decimal("-0.00025200"), Decimal("-0.00800000"))
                assert connection.execute(
                    text("SELECT amount,quota FROM billing_upstream_charges")
                ).one() == (Decimal("0.00025200"), 126)
                snapshot = connection.scalar(text("SELECT policy FROM billing_operations"))
                assert snapshot == {"max_request_amount": "0.00100000", "quota_per_cny": 500000}
                assert connection.scalar(
                    text("SELECT max_request_amount FROM billing_price_policies")
                ) == Decimal("0.00100000")
                migration.downgrade()
            assert connection.execute(
                text("SELECT available,frozen FROM billing_wallets ORDER BY available DESC")
            ).first() == (500000000, 800000)
            assert connection.execute(
                text("SELECT units,quota FROM billing_upstream_charges")
            ).one() == (25200, 126)
            assert connection.scalar(text("SELECT policy FROM billing_operations")) == {
                "max_request_units": 100000,
                "quota_per_cny": 500000,
            }
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
