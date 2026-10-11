"""附件的输入契约、逻辑目录和存储边界。"""

from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict, computed_field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.blog.models import BlogAttachment

STORAGE_ROOT = Path("/data/media/blog")
MAX_DEPTH = 30


def image_mime_type(item_id: UUID) -> str | None:
    """按文件签名识别可内嵌的位图，不信任扩展名或上传声明的 MIME。

    SVG、HTML 等主动内容只允许下载；位图仍由浏览器图片解码器校验。

    Args:
        item_id: 不随重命名或移动改变的文件标识。

    Returns:
        可内嵌的图片 MIME；未识别、缺失或不可读时返回 None。
    """
    try:
        with (STORAGE_ROOT / str(item_id)).open("rb") as source:
            header = source.read(32)
    except OSError:
        return None
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "image/webp"
    if header[4:8] == b"ftyp" and header[8:12] in (b"avif", b"avis"):
        return "image/avif"
    return None


def valid_name(value: str) -> str:
    """名称只用于展示，拒绝路径分隔符、控制字符与路径跳转。"""
    if (
        not value.strip()
        or value in {".", ".."}
        or len(value) > 255
        or any(ord(char) < 32 or ord(char) == 127 or char in "/\\" for char in value)
    ):
        raise ValueError("名称需为 1–255 字，不能包含路径分隔符、控制字符或仅有空格")
    return value


class FolderCreate(BaseModel):
    """稳定创建标识允许网络失败后安全重试。"""

    id: UUID
    name: str
    parent_id: UUID | None = None
    validate_name = field_validator("name")(valid_name)


class AttachmentUpdate(BaseModel):
    """完整写入名称、位置与可见性，必须匹配读取版本。"""

    name: str
    parent_id: UUID | None
    is_public: bool
    expected_updated_at: AwareDatetime
    validate_name = field_validator("name")(valid_name)


class AttachmentRead(BaseModel):
    """管理展示不包含磁盘路径与文件摘要。"""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    parent_id: UUID | None
    name: str
    kind: Literal["file", "folder"]
    mime_type: str
    size: int
    is_public: bool
    created_at: datetime
    updated_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def image_mime_type(self) -> str | None:
        """仅文件返回服务端识别的图片类型，目录不触碰文件存储。"""
        return image_mime_type(self.id) if self.kind == "file" else None

    @field_validator("created_at", "updated_at")
    @classmethod
    def timezone(cls, value: datetime) -> datetime:
        """SQLite 无时区测试值与 PostgreSQL 均返回明确 UTC 时间。"""
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class AttachmentList(BaseModel):
    """当前目录的有界列表与完整面包屑。"""

    items: list[AttachmentRead]
    breadcrumbs: list[AttachmentRead]
    total: int
    max_upload_bytes: int


def find(session: Session, owner_id: UUID, item_id: UUID) -> BlogAttachment:
    """未找到与跨账户对象统一返回 404。"""
    item = session.scalar(
        select(BlogAttachment).where(
            BlogAttachment.id == item_id, BlogAttachment.owner_id == owner_id
        )
    )
    if item is None:
        raise HTTPException(404, "附件或文件夹不存在")
    return item


def ancestors(session: Session, owner_id: UUID, parent_id: UUID | None) -> list[BlogAttachment]:
    """验证目标为目录并按根到叶返回祖先，限定逻辑树深度。"""
    result: list[BlogAttachment] = []
    while parent_id is not None:
        item = find(session, owner_id, parent_id)
        if item.kind != "folder":
            raise HTTPException(422, "目标位置必须是文件夹")
        if len(result) >= MAX_DEPTH or any(row.id == item.id for row in result):
            raise HTTPException(422, f"文件夹最多支持 {MAX_DEPTH} 层")
        result.append(item)
        parent_id = item.parent_id
    return list(reversed(result))


def sibling(
    session: Session, owner_id: UUID, parent_id: UUID | None, name: str
) -> BlogAttachment | None:
    """同一目录中文件和文件夹共用名称空间。"""
    return session.scalar(
        select(BlogAttachment).where(
            BlogAttachment.owner_id == owner_id,
            BlogAttachment.parent_id == parent_id,
            BlogAttachment.name == name,
        )
    )


def folder(owner_id: UUID, item_id: UUID, parent_id: UUID | None, name: str) -> BlogAttachment:
    """构造私有逻辑目录，不创建可控磁盘路径。"""
    return BlogAttachment(
        id=item_id,
        owner_id=owner_id,
        parent_id=parent_id,
        name=name,
        kind="folder",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
