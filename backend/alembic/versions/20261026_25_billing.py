"""新增钱包、冻结订单、不可变流水和上游实账，不追溯历史调用。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261026_25"
down_revision: str | None = "20261024_24"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """所有金额使用大整数，账务不级联依赖可删除的对话或作品。"""
    op.create_table(
        "billing_wallets",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("available", sa.BigInteger(), nullable=False),
        sa.Column("frozen", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("available >= 0 AND frozen >= 0"),
    )
    op.create_table(
        "billing_price_policies",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("model", sa.String(255), nullable=False),
        sa.Column("max_request_units", sa.BigInteger(), nullable=False),
        sa.Column("max_input_bytes", sa.Integer(), nullable=False),
        sa.Column("max_output_tokens", sa.Integer(), nullable=False),
        sa.Column("quota_per_cny", sa.BigInteger(), nullable=False),
        sa.Column("evidence", sa.String(1000), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "billing_operations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("source_id", sa.Uuid(), unique=True, nullable=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("model", sa.String(255), nullable=False),
        sa.Column("mode", sa.String(20), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("policy", sa.JSON(), nullable=False),
        *[
            sa.Column(name, sa.BigInteger(), nullable=False)
            for name in ("reserved", "charged", "cost")
        ],
        sa.Column("call_count", sa.Integer(), nullable=False),
        sa.Column("finished", sa.Boolean(), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False),
        sa.Column("next_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.String(500), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "billing_entries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("operation_id", sa.Uuid(), sa.ForeignKey("billing_operations.id"), nullable=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("event_key", sa.String(200), unique=True, nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("available_delta", sa.BigInteger(), nullable=False),
        sa.Column("frozen_delta", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "billing_upstream_charges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "operation_id", sa.Uuid(), sa.ForeignKey("billing_operations.id"), nullable=False
        ),
        sa.Column("channel", sa.String(80), nullable=False),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("units", sa.BigInteger(), nullable=False),
        sa.Column("quota", sa.BigInteger(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("refund_ids", sa.JSON(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("channel", "request_id"),
    )
    for table, column in (
        ("billing_price_policies", "model"),
        ("billing_operations", "user_id"),
        ("billing_operations", "status"),
        ("billing_entries", "user_id"),
        ("billing_upstream_charges", "operation_id"),
    ):
        op.create_index(f"ix_{table}_{column}", table, [column])


def downgrade() -> None:
    """显式回滚时按外键依赖移除新表。"""
    for table in (
        "billing_upstream_charges",
        "billing_entries",
        "billing_operations",
        "billing_price_policies",
        "billing_wallets",
    ):
        op.drop_table(table)
