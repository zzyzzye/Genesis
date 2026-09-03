from collections.abc import Generator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from genesis_api.core.config import get_settings


def build_engine(database_url: str) -> Engine:
    """创建可在 Web 请求和命令行任务中复用的数据库引擎。"""
    return create_engine(database_url, pool_pre_ping=True)


engine = build_engine(get_settings().resolved_database_url)
SessionLocal = sessionmaker[Session](
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


def get_session() -> Generator[Session, None, None]:
    """为每个 API 请求提供一个短生命周期的数据库会话。"""
    with SessionLocal() as session:
        yield session
