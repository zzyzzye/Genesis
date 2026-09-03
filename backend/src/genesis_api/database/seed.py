from datetime import UTC, datetime

from sqlalchemy import select

from genesis_api.blog.models import BlogPost, BlogPostStatus, BlogTag
from genesis_api.core.config import get_settings
from genesis_api.database.session import SessionLocal
from genesis_api.identity.models import User, UserCredential, UserRole
from genesis_api.identity.passwords import hash_password


def seed_database() -> None:
    """为开发环境写入幂等的示例内容，方便前端完成真实联调。"""
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

        existing_post = session.scalar(
            select(BlogPost).where(BlogPost.slug == "start-with-one-module")
        )
        if existing_post is not None:
            session.commit()
            return

        tags_by_slug: dict[str, BlogTag] = {}
        for name, slug in (("产品", "product"), ("工程", "engineering"), ("随笔", "notes")):
            tag = session.scalar(select(BlogTag).where(BlogTag.slug == slug))
            if tag is None:
                tag = BlogTag(name=name, slug=slug)
                session.add(tag)
            tags_by_slug[slug] = tag

        session.add_all(
            [
                BlogPost(
                    author=owner,
                    slug="start-with-one-module",
                    title="从一个完整模块开始",
                    excerpt="整合式个人网站不是把功能堆在首页，而是先让一个模块完整跑通。",
                    content_markdown="""# 从一个完整模块开始

这个网站会逐步拥有博客、工具和影音三个模块，但它们不是三个割裂的项目。

先完成博客，意味着我们能先验证一套共享的用户、内容、标签和媒体边界。之后的工具收藏、视频作者与观看记录，都可以复用同一套身份与权限基础。

先把一件事做好，再扩展到下一件事。""",
                    status=BlogPostStatus.PUBLISHED,
                    is_featured=True,
                    read_time_minutes=3,
                    published_at=datetime(2026, 9, 2, tzinfo=UTC),
                    tags=[tags_by_slug["product"], tags_by_slug["engineering"]],
                ),
                BlogPost(
                    author=owner,
                    slug="write-for-long-term",
                    title="把个人网站当作长期使用的空间",
                    excerpt="内容、工具和影音记录会持续增长，好的结构应当让它们自然地连接起来。",
                    content_markdown="""# 把个人网站当作长期使用的空间

网站的价值不只在发布一篇文章，也在于让日后的内容仍然找得到、用得顺手。

博客负责沉淀想法；工具模块负责整理可复用的能力；影音模块则记录值得反复观看的内容。它们共享用户与标签，但各自保持清晰的业务边界。""",
                    status=BlogPostStatus.PUBLISHED,
                    read_time_minutes=2,
                    published_at=datetime(2026, 8, 28, tzinfo=UTC),
                    tags=[tags_by_slug["notes"]],
                ),
            ]
        )
        session.commit()


if __name__ == "__main__":
    seed_database()
