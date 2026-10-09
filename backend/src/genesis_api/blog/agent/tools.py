from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from jwt import encode
from langchain_core.tools import BaseTool, tool
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from genesis_api.agent.context import require_owner
from genesis_api.agent.contracts import AgentActionProposal
from genesis_api.blog.models import BlogPost
from genesis_api.blog.service import get_blog_post_by_id, list_admin_posts
from genesis_api.core.config import Settings, get_settings
from genesis_api.database.session import SessionLocal

BlogAgentAction = Literal["create_draft", "update_post", "delete_post", "publish_post"]


def _owner_id() -> UUID:
    """从运行时注入的调用上下文取身份，不接受模型提供的用户 ID。"""
    return require_owner(module="blog")


def _summary(post: BlogPost) -> dict[str, object]:
    return {
        "id": str(post.id),
        "title": post.title,
        "excerpt": post.excerpt,
        "status": post.status.value,
        "updated_at": post.updated_at.isoformat(),
        "category": post.category.name if post.category else None,
        "tags": [tag.slug for tag in post.tags],
    }


def _detail(post: BlogPost) -> dict[str, object]:
    return {**_summary(post), "content_markdown": post.content_markdown, "slug": post.slug}


def _list_posts() -> str:
    _owner_id()
    with SessionLocal() as session:
        posts = [_summary(post) for post in list_admin_posts(session)]
        return json.dumps(posts, ensure_ascii=False)


def _get_post(post_id: str) -> str:
    _owner_id()
    try:
        parsed_id = UUID(post_id)
    except ValueError as exc:
        raise ValueError("post_id 无效") from exc
    with SessionLocal() as session:
        post = get_blog_post_by_id(session, parsed_id)
        if post is None:
            raise ValueError("文章不存在")
        return json.dumps(_detail(post), ensure_ascii=False)


def _search_posts(query: str) -> str:
    _owner_id()
    pattern = f"%{query}%"
    with SessionLocal() as session:
        posts = session.scalars(
            select(BlogPost)
            .where(
                or_(
                    BlogPost.title.ilike(pattern),
                    BlogPost.excerpt.ilike(pattern),
                    BlogPost.content_markdown.ilike(pattern),
                    BlogPost.slug.ilike(pattern),
                )
            )
            .options(selectinload(BlogPost.category), selectinload(BlogPost.tags))
            .order_by(BlogPost.updated_at.desc())
        )
        return json.dumps([_summary(post) for post in posts], ensure_ascii=False)


def _preview(action: BlogAgentAction, payload: dict[str, object], settings: Settings) -> str:
    """检查提议的基本条件并签名，实际写入留给用户确认后的处理流程。"""
    actor_id = _owner_id()
    with SessionLocal() as session:
        if action in {"update_post", "delete_post", "publish_post"}:
            try:
                post_id = UUID(str(payload.get("post_id")))
            except (TypeError, ValueError) as exc:
                raise ValueError("post_id 无效") from exc
            if get_blog_post_by_id(session, post_id) is None:
                raise ValueError("文章不存在")
        required = ("title", "excerpt", "content_markdown", "slug")
        if action == "create_draft" and any(not payload.get(key) for key in required):
            raise ValueError("创建草稿缺少必要字段")

    proposal_id = uuid4()
    expires_at = datetime.now(UTC) + timedelta(seconds=settings.agent_action_expire_seconds)
    # 把用户、模块、操作和载荷绑定到同一令牌，供确认接口验签并检查有效期。
    proposal_token = encode(
        {
            "proposal_id": str(proposal_id),
            "actor_id": str(actor_id),
            "module": "blog",
            "action": action,
            "payload": payload,
            "iat": datetime.now(UTC),
            "exp": expires_at,
        },
        settings.agent_action_secret.get_secret_value(),
        algorithm="HS256",
    )
    proposal = AgentActionProposal(
        proposal_id=proposal_id,
        module="blog",
        action=action,
        payload=payload,
        summary=f"确认{action}操作",
        expires_at=expires_at,
        proposal_token=proposal_token,
    )
    return proposal.model_dump_json()


def build_blog_tools(settings: Settings | None = None) -> list[BaseTool]:
    """使用 LangChain 原生工具装饰器注册博客工具，写工具仅返回操作提议。"""
    runtime_settings = settings or get_settings()

    # 同步数据库操作交给工作线程，各次调用独立创建 Session，避免阻塞流式输出。
    # asyncio.to_thread 会传播调用上下文，权限校验仍能取得运行时注入的身份。
    @tool
    async def list_posts() -> str:
        """列出博客文章及其状态。"""
        return await asyncio.to_thread(_list_posts)

    @tool
    async def get_post(post_id: str) -> str:
        """读取指定文章的完整内容。"""
        return await asyncio.to_thread(_get_post, post_id)

    @tool
    async def search_posts(query: str) -> str:
        """按标题、摘要、正文和 slug 搜索文章。"""
        return await asyncio.to_thread(_search_posts, query)

    @tool
    async def analyze_post(post_id: str) -> str:
        """获取指定文章的分析上下文。"""
        # 工具只读取正文，文章分析由模型结合返回内容完成。
        return await asyncio.to_thread(_get_post, post_id)

    @tool
    async def suggest_revision(post_id: str) -> str:
        """获取指定文章的改写上下文。"""
        # 改写建议由模型生成；采用建议时仍需走待确认的写操作。
        return await asyncio.to_thread(_get_post, post_id)

    @tool
    async def create_draft(
        title: str, excerpt: str, content_markdown: str, slug: str
    ) -> str:
        """生成创建草稿的待确认操作，不直接写入数据库。"""
        payload: dict[str, object] = {
            "title": title,
            "excerpt": excerpt,
            "content_markdown": content_markdown,
            "slug": slug,
        }
        return await asyncio.to_thread(_preview, "create_draft", payload, runtime_settings)

    @tool
    async def update_post(post_id: str, changes: str) -> str:
        """生成修改文章的待确认操作，不直接写入数据库。"""
        return await asyncio.to_thread(
            _preview, "update_post", {"post_id": post_id, "changes": changes}, runtime_settings
        )

    @tool
    async def delete_post(post_id: str) -> str:
        """生成删除文章的待确认操作，不直接写入数据库。"""
        return await asyncio.to_thread(
            _preview, "delete_post", {"post_id": post_id}, runtime_settings
        )

    @tool
    async def publish_post(post_id: str) -> str:
        """生成发布文章的待确认操作，不直接写入数据库。"""
        return await asyncio.to_thread(
            _preview, "publish_post", {"post_id": post_id}, runtime_settings
        )

    return [
        list_posts,
        get_post,
        search_posts,
        analyze_post,
        suggest_revision,
        create_draft,
        update_post,
        delete_post,
        publish_post,
    ]
