"""公开博客只读入口；服务层限制已发布状态，后台写入使用独立 Owner 路由。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from genesis_api.blog.guide import ArticleGuideContent, ArticleGuideRead, article_revision
from genesis_api.blog.links import BlogLinkList, BlogLinkPublic, list_links
from genesis_api.blog.models import BlogPost, BlogPostStatus, BlogTag
from genesis_api.blog.schemas import BlogPostDetail, BlogPostListResponse, BlogPostPreview
from genesis_api.blog.service import get_published_post, list_published_posts
from genesis_api.database.session import get_session

router = APIRouter(prefix="/blog", tags=["博客"])
SessionDependency = Annotated[Session, Depends(get_session)]


class PublicBlogTag(BaseModel):
    """仅统计已发布文章的公开标签，不泄露草稿分类信息。"""

    id: str
    name: str
    slug: str
    post_count: int


@router.get("/tags", response_model=list[PublicBlogTag])
def get_blog_tags(session: SessionDependency) -> list[PublicBlogTag]:
    """返回已发布文章使用的全部标签与文章数，不受文章分页影响。"""
    rows = session.execute(
        select(BlogTag.id, BlogTag.name, BlogTag.slug, func.count(BlogPost.id))
        .select_from(BlogPost)
        .join(BlogPost.tags)
        .where(BlogPost.status == BlogPostStatus.PUBLISHED, BlogPost.deleted_at.is_(None))
        .group_by(BlogTag.id, BlogTag.name, BlogTag.slug)
        .order_by(BlogTag.name, BlogTag.id)
    )
    return [
        PublicBlogTag(id=str(row[0]), name=row[1], slug=row[2], post_count=row[3]) for row in rows
    ]


@router.get("/links", response_model=BlogLinkList)
def get_blog_links(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 12,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> BlogLinkList:
    """分页返回作者明确设为公开的链接，隐藏项不进入计数。"""
    items, total = list_links(session, limit=limit, offset=offset, visible=True)
    return BlogLinkList(items=[BlogLinkPublic.model_validate(item) for item in items], total=total)


@router.get("/posts", response_model=BlogPostListResponse)
def get_blog_posts(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 12,
    offset: Annotated[int, Query(ge=0)] = 0,
    tag: str | None = None,
    q: Annotated[str, Query(max_length=200)] = "",
) -> BlogPostListResponse:
    """分页返回公开文章摘要，不要求登录。

    Args:
        session: 当前请求的数据库会话。
        limit: 每页数量，FastAPI 校验为 1 至 50。
        offset: 非负分页偏移。
        tag: 可选标签 slug，空值表示全部标签。
        q: 标题或摘要的普通文本关键词，不包含草稿。

    Returns:
        已发布文章的当前页与筛选后总数，不包含正文。
    """
    posts, total = list_published_posts(
        session,
        limit=limit,
        offset=offset,
        tag_slug=tag,
        query=q,
    )
    return BlogPostListResponse(
        items=[BlogPostPreview.model_validate(post) for post in posts],
        total=total,
    )


@router.get("/posts/{slug}", response_model=BlogPostDetail)
def get_blog_post(slug: str, session: SessionDependency) -> BlogPostDetail:
    """按公开地址返回已发布文章详情，隐藏草稿是否存在。

    Args:
        slug: 公开文章的地址标识。
        session: 当前请求的数据库会话。

    Returns:
        包含正文、作者、分类及标签的公开文章。

    Raises:
        HTTPException: 文章不存在或未发布，统一返回 404。
    """
    post = get_published_post(session, slug)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文章不存在或尚未发布")
    detail = BlogPostDetail.model_validate(post)
    detail.content_revision = article_revision(post)
    return detail


@router.get("/posts/{slug}/guide", response_model=ArticleGuideRead)
def get_article_guide(
    slug: str,
    session: SessionDependency,
    revision: Annotated[str | None, Query(pattern=r"^[a-f0-9]{64}$")] = None,
) -> ArticleGuideRead:
    """读取当前已发布文章的导读；草稿、撤回和不存在均返回 404。

    可携带正在阅读的内容指纹，避免新版本导读配到旧正文。
    缓存缺失或失败不影响正文，此接口不写数据也不调用模型。
    """
    post = get_published_post(session, slug)
    if post is None:
        raise HTTPException(status_code=404, detail="文章不存在或尚未发布")
    current_revision = article_revision(post)
    if revision is not None and revision != current_revision:
        return ArticleGuideRead(status="outdated")
    guide = post.guide
    if guide is None or guide.revision != current_revision:
        return ArticleGuideRead(status="unavailable")
    if guide.state in ("pending", "running"):
        return ArticleGuideRead(status="pending")
    if guide.state != "ready" or guide.payload is None:
        return ArticleGuideRead(status="unavailable")
    try:
        content = ArticleGuideContent.model_validate(guide.payload)
    except ValueError:
        return ArticleGuideRead(status="unavailable")
    return ArticleGuideRead(
        status="ready",
        key_points=[point.text for point in content.points],
        reading_focus=content.reading_focus,
    )
