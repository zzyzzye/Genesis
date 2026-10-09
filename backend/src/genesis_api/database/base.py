"""集中提供所有 ORM 实体共享的声明基类与迁移元数据。"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """所有持久化模型共享的 SQLAlchemy 基类。"""
