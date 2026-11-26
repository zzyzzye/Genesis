"""文章历史快照；保存统一调用此模块，恢复由编辑器核对后走原保存流程。"""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.blog.models import BlogPost, BlogPostRevision


def capture_revision(session: Session, post: BlogPost) -> None:
    """保存当前正文与编辑元数据，重复版本不重复插入，不提交事务。"""
    if post.updated_at is None:
        return
    if post.id is None:
        post.id = uuid4()
    with session.no_autoflush:
        if any(
            isinstance(item, BlogPostRevision)
            and item.post_id == post.id
            and item.version == post.updated_at
            for item in session.new
        ) or session.scalar(
            select(BlogPostRevision.id).where(
                BlogPostRevision.post_id == post.id,
                BlogPostRevision.version == post.updated_at,
            )
        ):
            return
        payload: dict[str, object] = {
            "slug": post.slug,
            "title": post.title,
            "excerpt": post.excerpt,
            "content_markdown": post.content_markdown,
            "cover_image_url": post.cover_image_url,
            "category_ids": [str(category.id) for category in post.categories],
            "tags": [{"name": tag.name, "slug": tag.slug} for tag in post.tags],
            "is_featured": post.is_featured,
            "read_time_minutes": post.read_time_minutes,
        }
        session.add(
            BlogPostRevision(
                post=post,
                post_id=post.id,
                version=post.updated_at,
                title=post.title,
                payload=payload,
            )
        )
