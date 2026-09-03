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
    post = get_published_post(session, slug)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文章不存在或尚未发布")
    return BlogPostDetail.model_validate(post)
