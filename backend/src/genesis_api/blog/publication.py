"""通过数据库行锁执行到期发布，复用现有应用生命周期及导读队列。"""

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.blog.guide import queue_article_guide
from genesis_api.blog.models import BlogPost, BlogPostStatus
from genesis_api.blog.operations import touch_post
from genesis_api.database.session import SessionLocal

logger = logging.getLogger(__name__)


def publish_due_posts(
    session_factory: Callable[[], Session] = SessionLocal, now: datetime | None = None
) -> int:
    """锁定最多 50 篇到期草稿并一次提交，多进程不会重复发布。

    Args:
        session_factory: 独立数据库会话工厂，便于测试和事务清理。
        now: 默认使用 UTC 当前时间，测试可指定时钟。

    Returns:
        本轮发布数量。停机期间的计划在下次执行时补发，回收站永不发布。
    """
    current = now or datetime.now(UTC)
    with session_factory() as session:
        posts = list(
            session.scalars(
                select(BlogPost)
                .where(
                    BlogPost.status == BlogPostStatus.DRAFT,
                    BlogPost.deleted_at.is_(None),
                    BlogPost.scheduled_at.is_not(None),
                    BlogPost.scheduled_at <= current,
                )
                .order_by(BlogPost.id)
                .limit(50)
                .with_for_update(skip_locked=True)
            )
        )
        for post in posts:
            # 写入入口已校验完整性；旧数据异常时取消计划，避免发布空白内容。
            if not all(
                value.strip() for value in (post.title, post.excerpt, post.content_markdown)
            ):
                post.scheduled_at = None
                touch_post(post)
                logger.warning("定时文章缺少必要内容，已取消计划，post_id=%s", post.id)
                continue
            post.status = BlogPostStatus.PUBLISHED
            post.published_at = current
            post.scheduled_at = None
            touch_post(post)
            queue_article_guide(post)
        session.commit()
        return sum(post.status == BlogPostStatus.PUBLISHED for post in posts)


async def refresh_scheduled_posts() -> None:
    """每五秒核对持久化计划；异常不丢弃计划，下一轮重新检查。"""
    while True:
        try:
            await asyncio.to_thread(publish_due_posts)
        except Exception:
            logger.warning("定时发布检查暂时失败，五秒后重试")
        await asyncio.sleep(5)
