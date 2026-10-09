"""公开博客只读入口；服务层限制已发布状态，后台写入使用独立 Owner 路由。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from genesis_api.blog.schemas import BlogPostDetail, BlogPostListResponse, BlogPostPreview
from genesis_api.blog.service import get_published_post, list_published_posts
from genesis_api.database.session import get_session

router = APIRouter(prefix="/blog", tags=["博客"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/posts", response_model=BlogPostListResponse)
def get_blog_posts(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 12,
    offset: Annotated[int, Query(ge=0)] = 0,
    tag: str | None = None,
) -> BlogPostListResponse:
    """分页返回公开文章摘要，不要求登录。

    Args:
        session: 当前请求的数据库会话。
        limit: 每页数量，FastAPI 校验为 1 至 50。
        offset: 非负分页偏移。
        tag: 可选标签 slug，空值表示全部标签。

    Returns:
        已发布文章的当前页与筛选后总数，不包含正文。
    """
    posts, total = list_published_posts(
        session,
        limit=limit,
        offset=offset,
        tag_slug=tag,
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
    return BlogPostDetail.model_validate(post)
