"""取消预算冻结，将未结算订单的历史冻结按凭证退回可用余额。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261028_30"
down_revision: str | None = "20261027_29"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """锁住资金表，追加解冻凭证并将未结算订单切换为按实账扣费。"""
    op.execute(
        sa.text("LOCK TABLE billing_wallets, billing_operations, billing_entries IN EXCLUSIVE MODE")
    )
    op.execute(
        sa.text("""
        WITH released AS (
            INSERT INTO billing_entries
                (id, user_id, operation_id, event_key, kind,
                 available_delta, frozen_delta, reason)
            SELECT gen_random_uuid(), o.user_id, o.id,
                   'release-budget:' || o.id::text, 'release',
                   SUM(e.frozen_delta), -SUM(e.frozen_delta),
                   '取消预算冻结，退回历史预留金额'
            FROM billing_operations o
            JOIN billing_entries e ON e.operation_id = o.id
            WHERE o.mode = 'paid' AND o.status <> 'settled'
            GROUP BY o.id, o.user_id
            HAVING SUM(e.frozen_delta) > 0
            ON CONFLICT (event_key) DO NOTHING
            RETURNING user_id, available_delta, frozen_delta
        ), totals AS (
            SELECT user_id, SUM(available_delta) AS available_delta,
                   SUM(frozen_delta) AS frozen_delta
            FROM released GROUP BY user_id
        )
        UPDATE billing_wallets w
        SET available = w.available + t.available_delta,
            frozen = w.frozen + t.frozen_delta
        FROM totals t WHERE w.user_id = t.user_id
    """)
    )
    op.execute(
        sa.text("""
        UPDATE billing_operations
        SET reserved = 0,
            policy = (policy::jsonb || '{"postpaid": true}'::jsonb)::json
        WHERE status <> 'settled'
    """)
    )


def downgrade() -> None:
    """资金退回属于已入账事实，回滚不得重写凭证或重新冻结。"""
