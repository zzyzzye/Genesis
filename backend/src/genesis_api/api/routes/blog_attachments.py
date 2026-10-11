"""作者附件管理与显式公开后的安全文件读取。"""

import logging
from datetime import UTC, datetime
from hashlib import sha256
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import AwareDatetime
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from genesis_api.api.dependencies import OwnerDependency, SessionDependency
from genesis_api.blog import attachments as storage
from genesis_api.blog.attachments import (
    AttachmentList,
    AttachmentRead,
    AttachmentUpdate,
    FolderCreate,
)
from genesis_api.blog.comments import utc
from genesis_api.blog.models import BlogAttachment
from genesis_api.core.uploads import MAX_UPLOAD_BYTES, copy_upload
from genesis_api.identity.models import User

admin_router = APIRouter(prefix="/admin/blog/attachments", tags=["博客附件"])
public_router = APIRouter(prefix="/blog/attachments", tags=["博客附件"])
logger = logging.getLogger(__name__)


def lock_owner(session: SessionDependency, owner: OwnerDependency) -> None:
    """串行目录写入，防止并发移动成环、同名覆盖及重试重复落盘。"""
    session.scalar(select(User).where(User.id == owner.id).with_for_update())


def commit(session: SessionDependency) -> None:
    """冲突返回业务错误，调用方保留输入重试。"""
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "此位置已有同名文件或文件夹，请修改名称") from None


@admin_router.get("", response_model=AttachmentList)
def list_attachments(
    session: SessionDependency,
    owner: OwnerDependency,
    folder_id: UUID | None = None,
    q: Annotated[str, Query(max_length=200)] = "",
    kind: Literal["file", "folder"] | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AttachmentList:
    """列出当前层级；文件夹优先，名称与 ID 保证分页稳定。"""
    path = storage.ancestors(session, owner.id, folder_id)
    stmt = select(BlogAttachment).where(
        BlogAttachment.owner_id == owner.id, BlogAttachment.parent_id == folder_id
    )
    if q.strip():
        stmt = stmt.where(BlogAttachment.name.icontains(q.strip(), autoescape=True))
    if kind:
        stmt = stmt.where(BlogAttachment.kind == kind)
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = session.scalars(
        stmt.order_by(BlogAttachment.kind.desc(), BlogAttachment.name, BlogAttachment.id)
        .offset(offset)
        .limit(limit)
    )
    return AttachmentList(
        items=[AttachmentRead.model_validate(item) for item in items],
        breadcrumbs=[AttachmentRead.model_validate(item) for item in path],
        total=total,
        max_upload_bytes=MAX_UPLOAD_BYTES,
    )


@admin_router.post("/folders", response_model=AttachmentRead, status_code=201)
def create_folder(
    data: FolderCreate, session: SessionDependency, owner: OwnerDependency
) -> AttachmentRead:
    """创建空目录；重试同一标识与内容返回原目录。"""
    lock_owner(session, owner)
    if len(storage.ancestors(session, owner.id, data.parent_id)) >= storage.MAX_DEPTH:
        raise HTTPException(422, "已到达文件夹层级上限")
    existing = session.get(BlogAttachment, data.id)
    if existing is not None:
        if (
            existing.owner_id != owner.id
            or existing.kind != "folder"
            or existing.name != data.name
            or existing.parent_id != data.parent_id
        ):
            raise HTTPException(409, "创建标识已使用，请刷新列表核对")
        return AttachmentRead.model_validate(existing)
    item = storage.folder(owner.id, data.id, data.parent_id, data.name)
    session.add(item)
    commit(session)
    return AttachmentRead.model_validate(item)


@admin_router.post("/files", response_model=AttachmentRead, status_code=201)
def upload_file(
    file: UploadFile,
    session: SessionDependency,
    owner: OwnerDependency,
    id: Annotated[UUID, Form()],
    parent_id: Annotated[UUID | None, Form()] = None,
    relative_path: Annotated[str | None, Form(max_length=8000)] = None,
) -> AttachmentRead:
    """接受任意类型与空文件，逐文件保留上传目录，禁止覆盖同名文件。

    同一上传 UUID 重试时核对实际内容摘要，回执与后续重命名、移动无关。
    写入只用 UUID；目录与文件记录在同一事务内提交，失败清理本次文件。
    """
    parts = (relative_path if relative_path is not None else file.filename or "未命名附件").split(
        "/"
    )
    try:
        for part in parts:
            storage.valid_name(part)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    lock_owner(session, owner)
    existing = session.get(BlogAttachment, id)
    if existing is not None:
        if existing.owner_id != owner.id or existing.kind != "file":
            raise HTTPException(409, "上传标识已使用，请刷新列表核对")
        digest = sha256()
        size = 0
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "单个文件不能超过 200 MiB")
            digest.update(chunk)
        if digest.hexdigest() != existing.sha256:
            raise HTTPException(409, "同一上传标识不能用于不同文件，请重新选择文件")
        return AttachmentRead.model_validate(existing)
    if len(parts) - 1 + len(storage.ancestors(session, owner.id, parent_id)) > storage.MAX_DEPTH:
        raise HTTPException(422, "上传的文件夹层级过深")
    path = storage.STORAGE_ROOT / str(id)
    written = False
    try:
        for name in parts[:-1]:
            directory = storage.sibling(session, owner.id, parent_id, name)
            if directory is None:
                directory = storage.folder(owner.id, uuid4(), parent_id, name)
                session.add(directory)
                session.flush()
            if directory.kind != "folder":
                raise HTTPException(409, f"「{name}」是文件，不能作为文件夹")
            parent_id = directory.id
        if storage.sibling(session, owner.id, parent_id, parts[-1]) is not None:
            raise HTTPException(409, "此位置已有同名文件或文件夹，请重命名后上传")
        size, digest_value = copy_upload(file, path, MAX_UPLOAD_BYTES, allow_empty=True)
        written = True
        item = BlogAttachment(
            id=id,
            owner_id=owner.id,
            parent_id=parent_id,
            name=parts[-1],
            kind="file",
            mime_type=(file.content_type or "application/octet-stream")[:255],
            size=size,
            sha256=digest_value,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session.add(item)
        commit(session)
        return AttachmentRead.model_validate(item)
    except OSError:
        session.rollback()
        if written:
            path.unlink(missing_ok=True)
        raise HTTPException(503, "附件存储暂不可用，请稍后重试") from None
    except Exception:
        session.rollback()
        if written:
            path.unlink(missing_ok=True)
        raise


@admin_router.get("/{item_id}", response_model=AttachmentRead)
def get_attachment(
    item_id: UUID, session: SessionDependency, owner: OwnerDependency
) -> AttachmentRead:
    """获取指定记录及最新版本，用于冲突核对。"""
    return AttachmentRead.model_validate(storage.find(session, owner.id, item_id))


@admin_router.put("/{item_id}", response_model=AttachmentRead)
def update_attachment(
    item_id: UUID, data: AttachmentUpdate, session: SessionDependency, owner: OwnerDependency
) -> AttachmentRead:
    """重命名、移动与可见性更新均校验版本；目录不得移入自身子树。"""
    lock_owner(session, owner)
    item = storage.find(session, owner.id, item_id)
    if utc(item.updated_at) != data.expected_updated_at.astimezone(UTC):
        raise HTTPException(409, "附件已更新，请关闭操作并刷新列表，核对后重试")
    target = storage.ancestors(session, owner.id, data.parent_id)
    if any(row.id == item.id for row in target):
        raise HTTPException(422, "不能把文件夹移入自身或子文件夹")
    if item.kind == "folder":
        if data.is_public:
            raise HTTPException(422, "文件夹不能整体公开，请逐个公开需要分享的文件")
        # 只取子树的 ID 与父级，避免把整个附件库加载进内存。
        level = [item.id]
        depth = 1
        while level:
            children = list(
                session.scalars(
                    select(BlogAttachment.id).where(
                        BlogAttachment.owner_id == owner.id,
                        BlogAttachment.parent_id.in_(level),
                        BlogAttachment.kind == "folder",
                    )
                )
            )
            if not children:
                break
            depth += 1
            level = children
            if len(target) + depth > storage.MAX_DEPTH:
                raise HTTPException(422, "移动后文件夹层级过深")
        if len(target) + depth > storage.MAX_DEPTH:
            raise HTTPException(422, "移动后文件夹层级过深")
    item.name, item.parent_id, item.is_public = data.name, data.parent_id, data.is_public
    item.updated_at = datetime.now(UTC)
    commit(session)
    return AttachmentRead.model_validate(item)


@admin_router.delete("/{item_id}", status_code=204)
def delete_attachment(
    item_id: UUID,
    expected_updated_at: AwareDatetime,
    session: SessionDependency,
    owner: OwnerDependency,
) -> Response:
    """仅删除空目录或指定版本文件，不隐式批量删除子内容。"""
    lock_owner(session, owner)
    item = storage.find(session, owner.id, item_id)
    if utc(item.updated_at) != expected_updated_at.astimezone(UTC):
        raise HTTPException(409, "附件已更新，请刷新列表核对后重试")
    if session.scalar(
        select(BlogAttachment.id).where(BlogAttachment.parent_id == item.id).limit(1)
    ):
        raise HTTPException(409, "文件夹不为空，请先移动或删除其中的内容")
    path = storage.STORAGE_ROOT / str(item.id)
    trash = storage.STORAGE_ROOT / f"{item.id}.{uuid4()}.deleting"
    staged = False
    if item.kind == "file" and path.exists():
        try:
            path.rename(trash)
            staged = True
        except OSError:
            raise HTTPException(503, "附件存储暂不可用，文件尚未删除，请稍后重试") from None
    try:
        session.delete(item)
        session.commit()
    except Exception:
        session.rollback()
        if staged:
            trash.rename(path)
        raise
    if staged:
        try:
            trash.unlink(missing_ok=True)
        except OSError:
            logger.warning("附件记录已删除，但临时文件清理失败，请检查持久化卷权限")
    return Response(status_code=204)


def file_response(item: BlogAttachment) -> FileResponse:
    """任意类型统一作为下载，避免 HTML、SVG 等内容在站点源执行。"""
    path = storage.STORAGE_ROOT / str(item.id)
    if item.kind != "file" or not path.is_file():
        raise HTTPException(404, "附件文件不可用")
    return FileResponse(
        path,
        filename=item.name,
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
        },
    )


@admin_router.get("/{item_id}/file")
def private_file(item_id: UUID, session: SessionDependency, owner: OwnerDependency) -> FileResponse:
    """只有附件所有者能下载私有内容。"""
    return file_response(storage.find(session, owner.id, item_id))


@public_router.get("/{item_id}/file")
def public_file(item_id: UUID, session: SessionDependency) -> FileResponse:
    """未显式公开与不存在统一 404；撤回公开即停止新的下载请求。"""
    item = session.scalar(
        select(BlogAttachment).where(
            BlogAttachment.id == item_id,
            BlogAttachment.is_public.is_(True),
            BlogAttachment.kind == "file",
        )
    )
    if item is None:
        raise HTTPException(404, "附件不存在或尚未公开")
    return file_response(item)
