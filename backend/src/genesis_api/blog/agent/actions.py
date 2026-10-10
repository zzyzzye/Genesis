"""执行用户已确认的博客写操作；提议生成与验签由工具及公共 API 负责。"""

from __future__ import annotations

import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from genesis_api.blog.models import BlogPost, BlogPostStatus
from genesis_api.blog.schemas import BlogPostWrite
from genesis_api.blog.service import (
    POST_SLUG_CONFLICT_MESSAGE,
    apply_post_data,
    get_blog_post_by_id,
    get_blog_post_by_slug,
)
from genesis_api.identity.models import User

BLOG_ACTIONS = {"create_draft", "update_post", "delete_post", "publish_post"}


def _save_post(session: Session, post: BlogPost, data: BlogPostWrite) -> None:
    """检查文章路径并提交写入，失败时回滚，避免泄露数据库语句与正文。

    Args:
        session: 当前确认请求的数据库会话。
        post: 待创建或更新的文章。
        data: 已通过完整写入契约校验的数据。

    Raises:
        HTTPException: 路径冲突返回 409，关联数据或业务校验失败返回 422。
    """
    try:
        # 查询时不提前刷新待写实体，避免路径检查本身触发唯一约束。
        with session.no_autoflush:
            existing = get_blog_post_by_slug(session, data.slug)
            if existing is not None and existing.id != post.id:
                raise HTTPException(status_code=409, detail=POST_SLUG_CONFLICT_MESSAGE)
            apply_post_data(session, post, data)
        session.commit()
    except HTTPException:
        session.rollback()
        raise
    except ValueError as exc:
        session.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except IntegrityError as exc:
        session.rollback()
        # 预检查之后仍可能并发占用路径，数据库约束是最终保障。
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint == "blog_posts_slug_key" or "blog_posts.slug" in str(exc.orig):
            raise HTTPException(status_code=409, detail=POST_SLUG_CONFLICT_MESSAGE) from None
        raise HTTPException(
            status_code=422, detail="文章保存失败，关联数据可能已变更，请刷新后重试。"
        ) from None


def _payload_uuid(payload: dict[str, object], key: str) -> UUID:
    """读取操作载荷中的 UUID，将格式错误转换为 API 校验错误。

    Args:
        payload: 已确认操作的载荷。
        key: UUID 字段名称。

    Returns:
        解析后的 UUID。

    Raises:
        HTTPException: 字段缺失或格式无效，状态码为 422。
    """
    try:
        return UUID(str(payload.get(key)))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"{key} 无效") from exc


def confirm_blog_action(
    action: str, payload: dict[str, object], *, current_user: User, session: Session
) -> object:
    """执行已确认的博客写操作，复用人工编辑的校验和业务写入逻辑。

    公共确认接口负责所有者权限、提议令牌及用户绑定校验；本函数负责业务校验
    与事务提交，不应作为模型可直接调用的工具注册。

    Args:
        action: create_draft、update_post、delete_post 或 publish_post。
        payload: 操作载荷；更新可包含 JSON 字符串或对象形式的 changes。
        current_user: 公共 API 已认证并校验权限的用户，也是新草稿的作者。
        session: 写入会话；成功时在此提交，字段应用的 ValueError 会触发回滚。

    Returns:
        操作名称、文章 ID 与执行结果标识，不返回文章全文。

    Raises:
        HTTPException: 操作或载荷无效时返回 422，文章不存在时返回 404，路径冲突返回 409。
        ValidationError: 合并后的文章数据不符合 BlogPostWrite 契约。
    """
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

    if action in {"update_post", "publish_post"}:
        post_id = _payload_uuid(payload, "post_id")
        # 确认时重新读取并锁定文章，以当前记录为基线；不把提议当作版本快照。
        post = get_blog_post_by_id(session, post_id, for_update=True)
        if post is None:
            raise HTTPException(status_code=404, detail="文章不存在")
        # 发布共用人工编辑的校验与写入逻辑，不能遗漏发布时间或公开不完整草稿。
        changes = (
            {"status": BlogPostStatus.PUBLISHED}
            if action == "publish_post"
            else payload.get("changes")
        )
        if isinstance(changes, str):
            try:
                changes = json.loads(changes)
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=422, detail="changes 必须是 JSON") from exc
        if not isinstance(changes, dict):
            raise HTTPException(status_code=422, detail="changes 必须是 JSON 对象")
        # 将局部修改合并到当前文章，再统一校验，避免绕过发布等业务约束。
        data = BlogPostWrite.model_validate(
            {
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
            }
        )
        _save_post(session, post, data)
        return {
            "action": action,
            "post_id": str(post_id),
            "status": "published" if action == "publish_post" else "updated",
        }

    required = ("title", "excerpt", "content_markdown", "slug")
    if any(not isinstance(payload.get(key), str) or not payload[key] for key in required):
        raise HTTPException(status_code=422, detail="创建草稿缺少必要字段")
    post = BlogPost(author=current_user)
    session.add(post)
    # 创建提议只落为草稿，公开发布仍须单独确认。
    data = BlogPostWrite.model_validate(
        {
            "title": payload["title"],
            "excerpt": payload["excerpt"],
            "content_markdown": payload["content_markdown"],
            "slug": payload["slug"],
            "status": BlogPostStatus.DRAFT,
        }
    )
    _save_post(session, post, data)
    return {"action": action, "post_id": str(post.id), "status": "created"}
