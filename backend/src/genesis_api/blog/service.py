"""博客查询与写入规则；调用方负责授权以及事务提交、失败回滚。"""

from datetime import UTC, datetime, timedelta
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
    """分页读取已发布文章，精选优先，其后按发布时间倒序。

    Args:
        session: 调用方提供的数据库会话。
        limit: 当前页最多返回的文章数，由路由校验范围。
        offset: 跳过的文章数。
        tag_slug: 可选标签标识；空值表示不按标签筛选。

    Returns:
        当前页文章与筛选后的总数，关联作者、分类和标签已批量加载。
    """
    statement = select(BlogPost).where(BlogPost.status == BlogPostStatus.PUBLISHED)
    if tag_slug:
        statement = statement.join(BlogPost.tags).where(BlogTag.slug == tag_slug)

    # 计数和分页共用过滤条件，计数不应用 limit/offset。
    total = session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    posts = list(
        session.scalars(
            # 批量加载响应中的关联数据，避免逐篇访问作者、分类和标签触发查询。
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
    """按公开地址读取已发布文章。

    Args:
        session: 调用方提供的数据库会话。
        slug: 文章公开地址中的稳定标识。

    Returns:
        已加载作者、分类和标签的文章；不存在或仍为草稿时返回 None。
    """
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
    """读取所有状态的文章，供后台列表与 Agent 使用。

    调用方必须先检查后台权限；此查询不分页，也不按作者过滤。

    Args:
        session: 调用方提供的数据库会话。

    Returns:
        按更新时间倒序的文章列表，包含草稿与已发布文章。
    """
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


def get_blog_post_by_id(
    session: Session, post_id: UUID, *, for_update: bool = False
) -> BlogPost | None:
    """按内部 ID 读取任意状态文章，不在此函数内执行权限校验。

    写入流程可指定 for_update 锁定文章行；锁随调用方事务提交或回滚释放。

    Args:
        session: 调用方提供的数据库会话。
        post_id: 文章内部 UUID，不是公开地址 slug。
        for_update: 是否申请行锁，供读后写流程使用；默认不锁定。

    Returns:
        任意状态的文章及其关联数据；不存在时返回 None。
    """
    statement = (
        select(BlogPost)
        .where(BlogPost.id == post_id)
        .options(
            selectinload(BlogPost.author),
            selectinload(BlogPost.category),
            selectinload(BlogPost.tags),
        )
    )
    if for_update:
        statement = statement.with_for_update()
    return session.scalar(statement)


def apply_post_data(session: Session, post: BlogPost, data: BlogPostWrite) -> None:
    """将已校验的完整数据应用到文章及标签，不提交事务。

    分类解析失败等异常可能发生在赋值之后，调用方须回滚整个事务。
    本函数不比较 expected_updated_at，并发版本检查由后台路由负责。

    Args:
        session: 当前事务的数据库会话，用于解析分类与标签。
        post: 待修改的文章实体，字段会原地更新。
        data: 经 BlogPostWrite 校验的完整文章数据，不是局部补丁。

    Raises:
        ValueError: 所选分类不存在。
    """
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

    # 首次发布补上时间，后续编辑保留原时间；转为草稿时清除公开发布时间。
    if data.status is BlogPostStatus.PUBLISHED:
        post.published_at = data.published_at or post.published_at or datetime.now(UTC)
    else:
        post.published_at = None

    # 显式保留微秒，避免数据库秒级时间戳漏掉同一秒内的编辑冲突。
    updated_at = datetime.now(UTC)
    if post.updated_at is not None:
        previous = post.updated_at
        if previous.tzinfo is None:
            previous = previous.replace(tzinfo=UTC)
        updated_at = max(updated_at, previous + timedelta(microseconds=1))
    post.updated_at = updated_at


def resolve_tags(session: Session, tag_inputs: list[BlogTagWrite]) -> list[BlogTag]:
    """按 slug 复用或新建共享标签，不提交事务。

    已有标签的名称会被输入值更新，影响所有引用该标签的文章。
    调用方应先用写入契约检查重复 slug，并负责最终提交或回滚。

    Args:
        session: 当前事务的数据库会话。
        tag_inputs: 待关联的标签名称与稳定标识。

    Returns:
        按输入顺序排列的标签实体；空输入返回空列表。
    """
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
            # 标签是共享记录，改名会影响所有关联文章，而非只改当前文章的显示。
            tag.name = tag_input.name
        resolved_tags.append(tag)

    return resolved_tags


def list_admin_tags(session: Session) -> list[BlogTag]:
    """按名称读取全部共享标签，包含未被文章使用的标签。

    Args:
        session: 调用方已完成后台权限检查的数据库会话。

    Returns:
        按名称升序排列的标签列表。
    """
    return list(session.scalars(select(BlogTag).order_by(BlogTag.name.asc())))


def list_admin_categories(session: Session) -> list[BlogCategory]:
    """按名称读取全部分类，供后台管理与文章设置选择。

    Args:
        session: 调用方已完成后台权限检查的数据库会话。

    Returns:
        按名称升序排列的分类列表。
    """
    return list(session.scalars(select(BlogCategory).order_by(BlogCategory.name.asc())))
