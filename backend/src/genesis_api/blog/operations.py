"""文章批量操作的版本核对与持久化回执；调用方负责权限和异常回滚。"""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from genesis_api.blog.comments import utc
from genesis_api.blog.models import BlogCategory, BlogOperation, BlogPost, BlogPostStatus, BlogTag
from genesis_api.blog.schemas import BlogPostAdminRead, BlogPostWrite
from genesis_api.blog.service import apply_post_data, trash_post
from genesis_api.identity.models import User

BatchAction = Literal[
    "publish",
    "unpublish",
    "trash",
    "restore",
    "permanent",
    "categories",
    "tags",
    "schedule",
    "cancel_schedule",
]


class PostVersion(BaseModel):
    """选择文章时的版本快照，防止批量覆盖其他页面的新内容。"""

    model_config = ConfigDict(extra="forbid")
    id: UUID
    expected_updated_at: AwareDatetime


class BlogBatchWrite(BaseModel):
    """最多对 200 篇明确选中的文章执行同一操作，不隐式选择后续新增文章。"""

    model_config = ConfigDict(extra="forbid")
    operation_id: UUID
    action: BatchAction
    items: list[PostVersion] = Field(min_length=1, max_length=200)
    category_ids: list[UUID] = Field(default_factory=list, max_length=100)
    tag_ids: list[UUID] = Field(default_factory=list, max_length=10)
    scheduled_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def unique_targets(self) -> "BlogBatchWrite":
        """重复标识属于请求错误，不静默丢弃用户的选择。"""
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("文章不能重复选择")
        if len(set(self.category_ids)) != len(self.category_ids):
            raise ValueError("分类不能重复")
        if len(set(self.tag_ids)) != len(self.tag_ids):
            raise ValueError("标签不能重复")
        return self


class BlogOperationResult(BaseModel):
    """持久化成功回执；重试返回同一结果，不重新导入、发布或删除。"""

    operation_id: UUID
    affected_ids: list[UUID]
    skipped: list[str] = Field(default_factory=list)


def operation_digest(value: object) -> str:
    """只保存请求摘要，不在回执表重复保存文章正文。"""
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()
    ).hexdigest()


def previous_operation(
    session: Session, owner: User, operation_id: UUID, kind: str, digest: str
) -> BlogOperationResult | None:
    """复用所有者行锁串行处理回执，避免同标识并发写入两次。

    Args:
        session: 当前事务会话，锁随提交或回滚释放。
        owner: 已由路由认证的站点所有者。
        operation_id: 当前操作的稳定标识。
        kind: 导入或批量操作类别。
        digest: 包含范围及参数的请求摘要。

    Returns:
        相同请求的已提交回执；新操作返回 None。

    Raises:
        HTTPException: 同一标识被用于其他请求时返回 409，不泄露原请求内容。
    """
    session.scalar(select(User).where(User.id == owner.id).with_for_update())
    receipt = session.get(BlogOperation, operation_id)
    if receipt is None:
        return None
    if (receipt.owner_id, receipt.kind, receipt.digest) != (owner.id, kind, digest):
        raise HTTPException(409, "操作标识已用于其他请求，请关闭操作面板后重新选择。")
    return BlogOperationResult.model_validate(receipt.result)


def save_operation(
    session: Session, owner: User, kind: str, digest: str, result: BlogOperationResult
) -> BlogOperationResult:
    """将业务修改和回执在同一事务提交，不保存任何登录凭据。"""
    session.add(
        BlogOperation(
            id=result.operation_id,
            owner_id=owner.id,
            kind=kind,
            digest=digest,
            result=result.model_dump(mode="json"),
        )
    )
    session.commit()
    return result


def touch_post(post: BlogPost) -> None:
    """即使同一微秒连续操作，也推进文章版本。"""
    post.updated_at = max(datetime.now(UTC), utc(post.updated_at) + timedelta(microseconds=1))


def apply_batch(session: Session, owner: User, data: BlogBatchWrite) -> BlogOperationResult:
    """先锁定并校验整批版本及发布条件，全部通过后才写入。

    Args:
        session: 当前事务；失败由路由回滚，防止部分文章被修改。
        owner: 已通过所有者鉴权的当前用户。
        data: 明确的文章列表、版本及操作参数。

    Returns:
        可用于网络重试核对的持久化回执。

    Raises:
        HTTPException: 版本或范围变更返回 409，内容不满足要求返回 400。
    """
    digest = operation_digest(data.model_dump(mode="json", exclude={"operation_id"}))
    previous = previous_operation(session, owner, data.operation_id, "batch", digest)
    if previous is not None:
        return previous
    versions = {item.id: item.expected_updated_at for item in data.items}
    posts = list(
        session.scalars(
            select(BlogPost)
            .where(BlogPost.id.in_(versions))
            .order_by(BlogPost.id)
            .options(
                selectinload(BlogPost.author),
                selectinload(BlogPost.category),
                selectinload(BlogPost.categories),
                selectinload(BlogPost.tags),
            )
            .with_for_update(of=BlogPost)
        )
    )
    if len(posts) != len(versions):
        raise HTTPException(409, "部分文章已不存在，请刷新列表并重新选择；本次未修改任何文章。")
    in_trash = data.action in {"restore", "permanent"}
    for post in posts:
        if (post.deleted_at is not None) != in_trash or utc(post.updated_at) != versions[post.id]:
            raise HTTPException(
                409, "部分文章状态或版本已变更，请刷新并重新选择；本次未修改任何文章。"
            )
    categories = list(
        session.scalars(select(BlogCategory).where(BlogCategory.id.in_(data.category_ids)))
    )
    tags = list(session.scalars(select(BlogTag).where(BlogTag.id.in_(data.tag_ids))))
    if data.action == "categories" and len(categories) != len(data.category_ids):
        raise HTTPException(400, "部分分类已不存在，请刷新后重新选择。")
    if data.action == "tags" and len(tags) != len(data.tag_ids):
        raise HTTPException(400, "部分标签已不存在，请刷新后重新选择。")
    if data.action == "schedule":
        if data.scheduled_at is None or data.scheduled_at <= datetime.now(UTC):
            raise HTTPException(400, "请选择晚于当前时间的定时发布时间。")
        if any(post.status != BlogPostStatus.DRAFT for post in posts):
            raise HTTPException(400, "只能为草稿安排定时发布，请先撤回已发布文章。")
    prepared: dict[UUID, BlogPostWrite] = {}
    for post in posts:
        if data.action in {"publish", "schedule", "categories", "tags", "unpublish"}:
            fields = BlogPostAdminRead.model_validate(post).model_dump(exclude={"scheduled_at"})
            fields["category_ids"] = [category.id for category in post.categories] or (
                [post.category_id] if post.category_id else []
            )
            if data.action in {"publish", "schedule"}:
                fields["status"] = BlogPostStatus.PUBLISHED
            if data.action == "unpublish":
                fields.update(status=BlogPostStatus.DRAFT, scheduled_at=None)
            if data.action == "categories":
                fields["category_ids"] = data.category_ids
            if data.action == "tags":
                fields["tags"] = [{"name": tag.name, "slug": tag.slug} for tag in tags]
            try:
                prepared[post.id] = BlogPostWrite.model_validate(fields)
            except ValidationError:
                raise HTTPException(
                    400,
                    f"「{post.title or '未命名文章'}」信息不完整，请完善标题、摘要和正文后重试。",
                ) from None
    with session.no_autoflush:
        for post in posts:
            if data.action == "trash":
                trash_post(post)
            elif data.action == "permanent":
                session.delete(post)
            elif data.action == "restore":
                post.deleted_at = None
                post.status = BlogPostStatus.DRAFT
                post.published_at = None
                post.scheduled_at = None
                touch_post(post)
            elif data.action == "schedule":
                post.scheduled_at = data.scheduled_at
                touch_post(post)
            elif data.action == "cancel_schedule":
                post.scheduled_at = None
                touch_post(post)
            else:
                apply_post_data(session, post, prepared[post.id])
    return save_operation(
        session,
        owner,
        "batch",
        digest,
        BlogOperationResult(
            operation_id=data.operation_id,
            affected_ids=[post.id for post in posts],
        ),
    )
