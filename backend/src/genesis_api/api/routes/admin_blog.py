from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError

from genesis_api.api.dependencies import OwnerDependency, SessionDependency
from genesis_api.blog.models import BlogCategory, BlogPost, BlogTag
from genesis_api.blog.schemas import (
    BlogCategoryRead,
    BlogCategoryWrite,
    BlogPostAdminRead,
    BlogPostWrite,
    BlogTagRead,
    BlogTagWrite,
)
from genesis_api.blog.service import (
    apply_post_data,
    get_blog_post_by_id,
    list_admin_categories,
    list_admin_posts,
    list_admin_tags,
)

router = APIRouter(prefix="/admin/blog", tags=["博客管理"])


def post_not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文章不存在")


def duplicate_slug_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="文章 slug 已被使用")


@router.get("/tags", response_model=list[BlogTagRead])
def get_admin_tags(session: SessionDependency, _: OwnerDependency) -> list[BlogTagRead]:
    return [BlogTagRead.model_validate(tag) for tag in list_admin_tags(session)]


@router.post("/tags", response_model=BlogTagRead, status_code=status.HTTP_201_CREATED)
def create_admin_tag(
    data: BlogTagWrite,
    session: SessionDependency,
    _: OwnerDependency,
) -> BlogTagRead:
    tag = BlogTag(name=data.name.strip(), slug=data.slug)
    session.add(tag)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="标签名称或 slug 已存在"
        ) from None
    session.refresh(tag)
    return BlogTagRead.model_validate(tag)


@router.get("/categories", response_model=list[BlogCategoryRead])
def get_admin_categories(session: SessionDependency, _: OwnerDependency) -> list[BlogCategoryRead]:
    return [
        BlogCategoryRead.model_validate(category) for category in list_admin_categories(session)
    ]


@router.post("/categories", response_model=BlogCategoryRead, status_code=status.HTTP_201_CREATED)
def create_admin_category(
    data: BlogCategoryWrite,
    session: SessionDependency,
    _: OwnerDependency,
) -> BlogCategoryRead:
    category = BlogCategory(name=data.name.strip(), slug=data.slug)
    session.add(category)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="分类名称或 slug 已存在"
        ) from None
    session.refresh(category)
    return BlogCategoryRead.model_validate(category)


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
    except ValueError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from None
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
    except ValueError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from None
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
