"""Alembic 迁移环境，复用应用配置并导入实体以注册表结构。"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from genesis_api.ai import models as ai_models
from genesis_api.blog import models as blog_models
from genesis_api.core.config import get_settings
from genesis_api.database.base import Base
from genesis_api.identity import models as identity_models
from genesis_api.media import models as media_models

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 导入模型会将所有模块表注册到 Base.metadata；别名用于明确迁移依赖。
_ = (ai_models, blog_models, identity_models, media_models)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """不连接数据库，仅编译迁移 SQL，实际执行由外部调用方负责。"""
    context.configure(
        url=get_settings().resolved_database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """建立迁移连接，在事务中执行所选升级或降级步骤。"""
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = get_settings().resolved_database_url
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
