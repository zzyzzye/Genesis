from __future__ import annotations

import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from genesis_api.blog.models import BlogPost, BlogPostStatus
from genesis_api.blog.schemas import BlogPostWrite
from genesis_api.blog.service import apply_post_data, get_blog_post_by_id
from genesis_api.identity.models import User

BLOG_ACTIONS = {"create_draft", "update_post", "delete_post", "publish_post"}


def _payload_uuid(payload: dict[str, object], key: str) -> UUID:
    try:
        return UUID(str(payload.get(key)))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"{key} 无效") from exc


def confirm_blog_action(
    action: str, payload: dict[str, object], *, current_user: User, session: Session
) -> object:
    """执行博客模块已经由用户确认的写操作。"""
    if action not in BLOG_ACTIONS:
        raise HTTPException(status_code=422, detail="博客操作类型无效")
    if action == "delete_post":
        post_id = _payload_uuid(payload, "post_id")
        post = get_blog_post_by_id(session, post_id)
        if post is None:
            raise HTTPException(status_code=404, detail="文章不存在")
        session.delete(post)
        session.commit()
        return {"action": action, "post_id": str(post_id), "status": "deleted"}

    if action == "publish_post":
        post_id = _payload_uuid(payload, "post_id")
        post = get_blog_post_by_id(session, post_id)
        if post is None:
            raise HTTPException(status_code=404, detail="文章不存在")
        post.status = BlogPostStatus.PUBLISHED
        session.commit()
        return {"action": action, "post_id": str(post_id), "status": "published"}

    if action == "update_post":
        post_id = _payload_uuid(payload, "post_id")
        post = get_blog_post_by_id(session, post_id)
        if post is None:
            raise HTTPException(status_code=404, detail="文章不存在")
        changes = payload.get("changes")
        if isinstance(changes, str):
            try:
                changes = json.loads(changes)
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=422, detail="changes 必须是 JSON") from exc
        if not isinstance(changes, dict):
            raise HTTPException(status_code=422, detail="changes 必须是 JSON 对象")
        data = BlogPostWrite.model_validate({
            "slug": changes.get("slug", post.slug),
            "title": changes.get("title", post.title),
            "excerpt": changes.get("excerpt", post.excerpt),
            "content_markdown": changes.get("content_markdown", post.content_markdown),
            "cover_image_url": changes.get("cover_image_url", post.cover_image_url),
            "category_id": changes.get("category_id", post.category_id),
            "status": changes.get("status", post.status),
            "is_featured": changes.get("is_featured", post.is_featured),
            "read_time_minutes": changes.get("read_time_minutes", post.read_time_minutes),
            "published_at": changes.get("published_at", post.published_at),
            "tags": changes.get(
                "tags", [{"name": tag.name, "slug": tag.slug} for tag in post.tags]
            ),
        })
        try:
            apply_post_data(session, post, data)
            session.commit()
        except ValueError as exc:
            session.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"action": action, "post_id": str(post_id), "status": "updated"}

    required = ("title", "excerpt", "content_markdown", "slug")
    if any(not isinstance(payload.get(key), str) or not payload[key] for key in required):
        raise HTTPException(status_code=422, detail="创建草稿缺少必要字段")
    post = BlogPost(author=current_user)
    session.add(post)
    data = BlogPostWrite.model_validate({
        "title": payload["title"], "excerpt": payload["excerpt"],
        "content_markdown": payload["content_markdown"], "slug": payload["slug"],
        "status": BlogPostStatus.DRAFT,
    })
    try:
        apply_post_data(session, post, data)
        session.commit()
    except ValueError as exc:
        session.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"action": action, "post_id": str(post.id), "status": "created"}
