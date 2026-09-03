from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """所有持久化模型共享的 SQLAlchemy 基类。"""
