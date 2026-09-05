from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError

from genesis_api.api.dependencies import OwnerDependency, SessionDependency
from genesis_api.blog.models import BlogPost
from genesis_api.blog.schemas import BlogPostAdminRead, BlogPostWrite
from genesis_api.blog.service import apply_post_data, get_blog_post_by_id, list_admin_posts

router = APIRouter(prefix="/admin/blog", tags=["博客管理"])


def post_not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文章不存在")


def duplicate_slug_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="文章 slug 已被使用")


@router.get("/posts", response_model=list[BlogPostAdminRead])
def get_admin_posts(session: SessionDependency, _: OwnerDependency) -> list[BlogPostAdminRead]:
    return [BlogPostAdminRead.model_validate(post) for post in list_admin_posts(session)]


@router.get("/posts/{post_id}", response_model=BlogPostAdminRead)
def get_admin_post(
    post_id: UUID,
    session: SessionDependency,
    _: OwnerDependency,
) -> BlogPostAdminRead:
    post = get_blog_post_by_id(session, post_id)
    if post is None:
        raise post_not_found()
    return BlogPostAdminRead.model_validate(post)


@router.post("/posts", response_model=BlogPostAdminRead, status_code=status.HTTP_201_CREATED)
def create_admin_post(
    data: BlogPostWrite,
    session: SessionDependency,
    owner: OwnerDependency,
) -> BlogPostAdminRead:
    post = BlogPost(author=owner)
    session.add(post)
    try:
        with session.no_autoflush:
            apply_post_data(session, post, data)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise duplicate_slug_error() from None
    return BlogPostAdminRead.model_validate(post)


@router.put("/posts/{post_id}", response_model=BlogPostAdminRead)
def update_admin_post(
    post_id: UUID,
    data: BlogPostWrite,
    session: SessionDependency,
    _: OwnerDependency,
) -> BlogPostAdminRead:
    post = get_blog_post_by_id(session, post_id)
    if post is None:
        raise post_not_found()

    try:
        with session.no_autoflush:
            apply_post_data(session, post, data)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise duplicate_slug_error() from None
    return BlogPostAdminRead.model_validate(post)


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_post(
    post_id: UUID,
    session: SessionDependency,
    _: OwnerDependency,
) -> Response:
    post = get_blog_post_by_id(session, post_id)
    if post is None:
        raise post_not_found()
    session.delete(post)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


