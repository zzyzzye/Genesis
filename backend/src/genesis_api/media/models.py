"""影音作品与素材元数据；文件存于媒体目录，作品通过关联表复用素材。"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from genesis_api.database.base import Base


class MediaProject(Base):
    """用户私有作品；画布以 JSON 保存，version 用于拒绝过期版本覆盖。"""

    __tablename__ = "media_projects"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    canvas: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MediaAsset(Base):
    """用户私有素材；in_library 表示独立保留在素材库，不随最后一个作品引用清理。"""

    __tablename__ = "media_assets"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(10))
    size: Mapped[int] = mapped_column(Integer)
    in_library: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProjectAsset(Base):
    """作品与素材的复用关系，不复制素材文件；联合主键避免重复引用。"""

    __tablename__ = "media_project_assets"

    project_id: Mapped[UUID] = mapped_column(ForeignKey("media_projects.id"), primary_key=True)
    asset_id: Mapped[UUID] = mapped_column(ForeignKey("media_assets.id"), primary_key=True)
