"""将历史生成图片的任务编号名称统一为画布成品名称。"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261103_31"
down_revision: str | None = "20261028_30"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """仅修复系统生成的旧名，优先使用所属作品中唯一的成品名。"""
    op.execute("""
        WITH candidates AS (
            SELECT a.id,
                COALESCE(
                    (SELECT min(n->>'name')
                     FROM media_projects p,
                          jsonb_array_elements(COALESCE(p.canvas::jsonb->'nodes', '[]'::jsonb)) n
                     WHERE p.id = g.project_id AND p.owner_id = a.owner_id
                       AND n->>'asset_id' = a.id::text
                       AND n->'image_result'->>'task_id' = g.id::text
                       AND length(trim(n->>'name')) > 0
                     HAVING count(DISTINCT n->>'name') = 1),
                    left(COALESCE(NULLIF(trim(g.snapshot->>'name'), ''), '生图'), 100)
                        || ' · 图片 ' || output.position::text
                ) AS name
            FROM media_image_generations g
            CROSS JOIN LATERAL jsonb_array_elements_text(g.asset_ids::jsonb)
                WITH ORDINALITY AS output(asset_id, position)
            JOIN media_assets a ON a.id::text = output.asset_id AND a.owner_id = g.owner_id
            WHERE a.name ~ '^生成图片-[0-9a-f]{8}-[0-9]+\\.(png|jpg|gif|webp|avif)$'
        )
        UPDATE media_assets a SET name = left(c.name, 120)
        FROM candidates c WHERE a.id = c.id
    """)


def downgrade() -> None:
    """保留已修复的用户可见名称，不恢复任务编号式旧名。"""
