from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from genesis_api.blog.models import BlogCategory, BlogPost, BlogPostStatus, BlogTag
from genesis_api.blog.schemas import BlogPostWrite, BlogTagWrite


def list_published_posts(
    session: Session,
    *,
    limit: int,
    offset: int,
    tag_slug: str | None,
) -> tuple[list[BlogPost], int]:
    statement = select(BlogPost).where(BlogPost.status == BlogPostStatus.PUBLISHED)
    if tag_slug:
        statement = statement.join(BlogPost.tags).where(BlogTag.slug == tag_slug)

    total = session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    posts = list(
        session.scalars(
            statement.options(
                selectinload(BlogPost.author),
                selectinload(BlogPost.category),
                selectinload(BlogPost.tags),
            )
            .order_by(BlogPost.is_featured.desc(), BlogPost.published_at.desc())
            .offset(offset)
            .limit(limit)
        )
    )
    return posts, total


def get_published_post(session: Session, slug: str) -> BlogPost | None:
    statement = (
        select(BlogPost)
        .where(
            BlogPost.slug == slug,
            BlogPost.status == BlogPostStatus.PUBLISHED,
        )
        .options(
            selectinload(BlogPost.author),
            selectinload(BlogPost.category),
            selectinload(BlogPost.tags),
        )
    )
    return session.scalar(statement)


def list_admin_posts(session: Session) -> list[BlogPost]:
    statement = (
        select(BlogPost)
        .options(
            selectinload(BlogPost.author),
            selectinload(BlogPost.category),
            selectinload(BlogPost.tags),
        )
        .order_by(BlogPost.updated_at.desc())
    )
    return list(session.scalars(statement))


def get_blog_post_by_id(session: Session, post_id: UUID) -> BlogPost | None:
    statement = (
        select(BlogPost)
        .where(BlogPost.id == post_id)
        .options(
            selectinload(BlogPost.author),
            selectinload(BlogPost.category),
            selectinload(BlogPost.tags),
        )
    )
    return session.scalar(statement)


def apply_post_data(session: Session, post: BlogPost, data: BlogPostWrite) -> None:
    post.slug = data.slug
    post.title = data.title
    post.excerpt = data.excerpt
    post.content_markdown = data.content_markdown
    post.cover_image_url = data.cover_image_url
    post.category = session.get(BlogCategory, data.category_id) if data.category_id else None
    if data.category_id and post.category is None:
        raise ValueError("所选分类不存在")
    post.status = data.status
    post.is_featured = data.is_featured
    post.read_time_minutes = data.read_time_minutes
    post.tags = resolve_tags(session, data.tags)

    if data.status is BlogPostStatus.PUBLISHED:
        post.published_at = data.published_at or post.published_at or datetime.now(UTC)
    else:
        post.published_at = None


def resolve_tags(session: Session, tag_inputs: list[BlogTagWrite]) -> list[BlogTag]:
    if not tag_inputs:
        return []

    existing_tags = session.scalars(
        select(BlogTag).where(BlogTag.slug.in_([tag.slug for tag in tag_inputs]))
    )
    tags_by_slug = {tag.slug: tag for tag in existing_tags}
    resolved_tags: list[BlogTag] = []

    for tag_input in tag_inputs:
        tag = tags_by_slug.get(tag_input.slug)
        if tag is None:
            tag = BlogTag(name=tag_input.name, slug=tag_input.slug)
            session.add(tag)
        else:
            tag.name = tag_input.name
        resolved_tags.append(tag)

    return resolved_tags


def list_admin_tags(session: Session) -> list[BlogTag]:
    return list(session.scalars(select(BlogTag).order_by(BlogTag.name.asc())))


def list_admin_categories(session: Session) -> list[BlogCategory]:
    return list(session.scalars(select(BlogCategory).order_by(BlogCategory.name.asc())))
