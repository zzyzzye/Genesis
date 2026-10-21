"""执行用户已确认的博客写操作；提议生成与验签由工具及公共 API 负责。"""

from __future__ import annotations

import json
from uuid import UUID

from fastapi import HTTPException
from pydantic import AwareDatetime, TypeAdapter
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from genesis_api.blog.comments import utc
from genesis_api.blog.models import BlogCategory, BlogPost, BlogPostStatus
from genesis_api.blog.schemas import BlogPostWrite
from genesis_api.blog.service import (
    POST_SLUG_CONFLICT_MESSAGE,
    apply_post_data,
    get_blog_post_by_id,
    get_blog_post_by_slug,
    list_admin_tags,
    trash_post,
)
from genesis_api.identity.models import User

BLOG_ACTIONS = {"create_draft", "create_and_publish", "update_post", "delete_post", "publish_post"}


def check_post_version(post: BlogPost, expected: object) -> None:
    """核对读取或提议时的版本；旧签名提议未携带版本时保持兼容。

    Args:
        post: 当前读取的文章；最终执行时应已加行锁。
        expected: 原样回传的更新时间，必须含时区；None 兼容历史提议。

    Raises:
        HTTPException: 版本不同返回 409，提示重新读取而非覆盖。
        ValidationError: 回传版本不是有效的带时区时间。
    """
    if expected is not None and utc(post.updated_at) != TypeAdapter(AwareDatetime).validate_python(
        expected
    ):
        raise HTTPException(409, "文章已变更，请重新读取最新内容并生成操作提议。")


def post_write_data(
    action: str, payload: dict[str, object], post: BlogPost | None = None,
) -> BlogPostWrite:
    """合并局部修改并复用完整文章契约，供提议预检与最终执行共同使用。

    Args:
        action: 创建、更新或发布操作。
        payload: 工具参数；兼容历史提议中字符串形式的 changes。
        post: 更新或发布时锁定或预读的文章，新建时为空。

    Returns:
        校验后的完整文章数据；未指定计划时不向写入层传入 scheduled_at。

    Raises:
        HTTPException: 参数格式、未知修改字段或必要字段无效。
        ValidationError: 文章内容、关联标识或发布时间不符合业务契约。
    """
    if action in {"create_draft", "create_and_publish"}:
        required = ("title", "excerpt", "content_markdown", "slug")
        if any(not isinstance(payload.get(key), str) or not payload[key] for key in required):
            raise HTTPException(422, "创建草稿缺少必要字段")
        return BlogPostWrite.model_validate({
            **{key: value for key, value in payload.items() if key in BlogPostWrite.model_fields},
            "status": (
                BlogPostStatus.PUBLISHED if action == "create_and_publish" else BlogPostStatus.DRAFT
            ),
        })

    if post is None:
        raise HTTPException(404, "文章不存在")
    changes = {"status": BlogPostStatus.PUBLISHED} if action == "publish_post" else payload.get(
        "changes"
    )
    if isinstance(changes, str):
        try:
            changes = json.loads(changes)
        except json.JSONDecodeError as exc:
            raise HTTPException(422, "changes 必须是 JSON") from exc
    if not isinstance(changes, dict):
        raise HTTPException(422, "changes 必须是 JSON 对象")
    allowed = BlogPostWrite.model_fields.keys() - {"expected_updated_at"}
    if changes.keys() - allowed:
        raise HTTPException(422, "包含不支持的修改字段，请使用文章写入契约中的字段名。")
    return BlogPostWrite.model_validate({
        "slug": post.slug, "title": post.title, "excerpt": post.excerpt,
        "content_markdown": post.content_markdown, "cover_image_url": post.cover_image_url,
        "category_id": post.category_id,
        "category_ids": [str(category.id) for category in post.categories],
        "status": post.status, "is_featured": post.is_featured,
        "read_time_minutes": post.read_time_minutes, "published_at": post.published_at,
        "tags": [{"name": tag.name, "slug": tag.slug} for tag in post.tags],
        **({"category_ids": None} if "category_id" in changes and "category_ids" not in changes
           else {}),
        **changes,
    })


def check_post_references(session: Session, data: BlogPostWrite) -> list[str]:
    """预检分类并避免文章操作意外重命名共享标签，不执行任何写入。

    Args:
        session: 当前数据库会话，不在此提交。
        data: 经过文章契约校验的完整数据。

    Returns:
        按所选顺序返回分类名称，用于操作卡片展示。

    Raises:
        HTTPException: 分类不存在或输入试图重命名共享标签，返回 422。
    """
    category_ids = data.category_ids
    if category_ids is None:
        category_ids = [data.category_id] if data.category_id else []
    categories = [session.get(BlogCategory, item_id) for item_id in category_ids]
    if any(category is None for category in categories):
        raise HTTPException(422, "所选分类不存在，请先读取分类和标签列表。")
    names = {tag.slug: tag.name for tag in list_admin_tags(session)}
    if any(tag.slug in names and tag.name != names[tag.slug] for tag in data.tags):
        raise HTTPException(422, "已有标签请沿用其名称；重命名共享标签请到标签管理中操作。")
    return [category.name for category in categories if category is not None]


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
            check_post_references(session, data)
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
        action: 创建草稿、创建并发布、更新、删除或发布现有文章。
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
        post = get_blog_post_by_id(session, post_id, for_update=True, include_deleted=True)
        if post is None:
            raise HTTPException(status_code=404, detail="文章不存在")
        if post.deleted_at is None:
            check_post_version(post, payload.get("expected_updated_at"))
        trash_post(post)
        session.commit()
        return {"action": action, "post_id": str(post_id), "status": "trashed"}

    if action in {"update_post", "publish_post"}:
        post_id = _payload_uuid(payload, "post_id")
        # 确认时重新读取并锁定文章，以当前记录为基线；不把提议当作版本快照。
        post = get_blog_post_by_id(session, post_id, for_update=True)
        if post is None:
            raise HTTPException(status_code=404, detail="文章不存在")
        check_post_version(post, payload.get("expected_updated_at"))
        data = post_write_data(action, payload, post)
        _save_post(session, post, data)
        return {
            "action": action,
            "post_id": str(post_id),
            "status": "published" if action == "publish_post" else "updated",
            **({"scheduled_at": utc(post.scheduled_at).isoformat() if post.scheduled_at else None}
               if "scheduled_at" in data.model_fields_set else {}),
        }

    # 创建并发布共用同一事务，不先提交草稿，也不要求第二次确认。
    data = post_write_data(action, payload)
    post = BlogPost(author=current_user)
    session.add(post)
    _save_post(session, post, data)
    return {
        "action": action, "post_id": str(post.id),
        "status": "published" if action == "create_and_publish" else "created",
        **({"scheduled_at": utc(post.scheduled_at).isoformat()}
           if post.scheduled_at else {}),
    }
