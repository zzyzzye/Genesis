"""将账务金额统一迁移为 NUMERIC 人民币元，保持经济金额和凭证标识不变。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261027_27"
down_revision: str | None = "20261026_26"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

MONEY_COLUMNS = {
    "billing_wallets": ("available", "frozen"),
    "billing_entries": ("available_delta", "frozen_delta"),
    "billing_operations": ("reserved", "charged", "cost"),
    "billing_price_policies": ("max_request_units",),
    "billing_upstream_charges": ("units",),
}
RENAMES = {"max_request_units": "max_request_amount", "units": "amount"}


def upgrade() -> None:
    """一次事务转换列和报价快照；上游原始 quota 及其换算基数保持整数。"""
    for table, columns in MONEY_COLUMNS.items():
        for column in columns:
            op.alter_column(
                table,
                column,
                type_=sa.Numeric(20, 8),
                existing_type=sa.BigInteger(),
                postgresql_using=f'"{column}"::numeric / 100000000',
                **({"new_column_name": RENAMES[column]} if column in RENAMES else {}),
            )
    op.execute(
        sa.text("""
        UPDATE billing_operations
        SET policy = jsonb_set(
            policy::jsonb - 'max_request_units',
            '{max_request_amount}',
            to_jsonb(((policy->>'max_request_units')::numeric / 100000000)::numeric(20,8)::text)
        )::json
        WHERE policy::jsonb ? 'max_request_units'
    """)
    )


def downgrade() -> None:
    """按八位精度无损回到旧最小单位，恢复旧列名和快照字段。"""
    op.execute(
        sa.text("""
        UPDATE billing_operations
        SET policy = jsonb_set(
            policy::jsonb - 'max_request_amount',
            '{max_request_units}',
            to_jsonb(((policy->>'max_request_amount')::numeric * 100000000)::bigint)
        )::json
        WHERE policy::jsonb ? 'max_request_amount'
    """)
    )
    for table, columns in reversed(tuple(MONEY_COLUMNS.items())):
        for old_name in columns:
            column = RENAMES.get(old_name, old_name)
            op.alter_column(
                table,
                column,
                type_=sa.BigInteger(),
                existing_type=sa.Numeric(20, 8),
                postgresql_using=f'("{column}" * 100000000)::bigint',
                **({"new_column_name": old_name} if column != old_name else {}),
            )
