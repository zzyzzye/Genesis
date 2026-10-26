"""开发所有者账号初始化入口，不创建示例文章或标签。"""

from sqlalchemy import select

from genesis_api.blog import models as blog_models
from genesis_api.core.config import get_settings
from genesis_api.database.session import SessionLocal
from genesis_api.identity.models import User, UserCredential, UserRole
from genesis_api.identity.passwords import hash_password

# 注册 User.blog_posts 依赖的模型，保证独立运行初始化命令时关系可解析。
_ = blog_models


def seed_database() -> None:
    """初始化开发所有者及其凭据，并提交事务。

    已有所有者不覆盖资料；缺少凭据时补建，不改动文章或标签。
    此函数自身不校验部署环境，调用方应确保仅在需要开发账号的环境执行。
    """
    settings = get_settings()
    with SessionLocal() as session:
        owner = session.scalar(select(User).where(User.handle == "genesis"))
        if owner is None:
            owner = User(
                handle="genesis",
                display_name="Genesis",
                bio="记录构建一个长期使用的个人数字空间。",
                role=UserRole.OWNER,
                credential=UserCredential(
                    password_hash=hash_password(
                        settings.development_owner_password.get_secret_value()
                    )
                ),
            )
            session.add(owner)
        elif owner.credential is None:
            owner.credential = UserCredential(
                password_hash=hash_password(settings.development_owner_password.get_secret_value())
            )

        session.commit()


if __name__ == "__main__":
    seed_database()
