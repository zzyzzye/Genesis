"""进程共享数据库引擎及请求级会话，事务提交由业务调用方负责。"""

from collections.abc import Generator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from genesis_api.core.config import get_settings


def build_engine(database_url: str) -> Engine:
    """创建启用连接存活检测的 SQLAlchemy 引擎。

    Args:
        database_url: 数据库连接地址，可能包含凭据，不得记录。

    Returns:
        可复用的数据库引擎，不在此创建业务表或执行迁移。
    """
    return create_engine(database_url, pool_pre_ping=True)


engine = build_engine(get_settings().resolved_database_url)
SessionLocal = sessionmaker[Session](
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


def get_session() -> Generator[Session, None, None]:
    """为每个 API 请求提供独立会话，退出时关闭资源。

    Yields:
        当前请求的 Session，不自动提交；调用方负责业务事务提交或回滚。
    """
    with SessionLocal() as session:
        yield session
