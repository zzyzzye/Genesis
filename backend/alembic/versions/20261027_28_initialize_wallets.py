"""为已有用户补齐零余额钱包，保留所有既有金额和账务凭证。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261027_28"
down_revision: str | None = "20261027_27"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """仅插入缺失的钱包，不生成流水或覆盖已有余额。"""
    op.execute(sa.text("""
        INSERT INTO billing_wallets (user_id, available, frozen)
        SELECT users.id, 0.00000000, 0.00000000
        FROM users
        LEFT JOIN billing_wallets ON billing_wallets.user_id = users.id
        WHERE billing_wallets.user_id IS NULL
        ON CONFLICT (user_id) DO NOTHING
    """))


def downgrade() -> None:
    """补齐的钱包可能已发生交易，回滚时保留账务主体和资金。"""
