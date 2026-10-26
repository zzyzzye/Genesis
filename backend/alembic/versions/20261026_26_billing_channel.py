"""将价格审核绑定到确实核验过的渠道，换域名或 Key 后重新审核。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261026_26"
down_revision: str | None = "20261026_25"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """未知历史渠道使用空指纹，不能自动授权新付费报价。"""
    op.add_column(
        "billing_price_policies",
        sa.Column("channel", sa.String(100), server_default="", nullable=False),
    )


def downgrade() -> None:
    """撤销渠道绑定字段，不更改钱包与既有实账。"""
    op.drop_column("billing_price_policies", "channel")
