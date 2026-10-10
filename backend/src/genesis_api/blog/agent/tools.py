"""博客 Agent 的 LangChain 工具：读取文章或生成签名提议，不直接写库。

带 @tool 的函数文档也会提供给模型作为工具说明，参数含义与权限边界须准确。
同步数据库操作在独立工作线程中执行，每次调用创建自己的会话。
"""

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
from genesis_api.blog.service import (
    POST_SLUG_CONFLICT_MESSAGE,
    get_blog_post_by_id,
    get_blog_post_by_slug,
    list_admin_posts,
)
from genesis_api.core.config import Settings, get_settings
from genesis_api.database.session import SessionLocal

BlogAgentAction = Literal["create_draft", "update_post", "delete_post", "publish_post"]


def _owner_id() -> UUID:
    """从运行时注入的调用上下文取身份，不接受模型提供的用户 ID。

    Returns:
        当前博客工具调用的站点所有者 UUID。

    Raises:
        RuntimeError: 缺少身份、用户不是所有者，或调用不属于博客模块。
    """
    return require_owner(module="blog")


def _summary(post: BlogPost) -> dict[str, object]:
    """提取供模型浏览或搜索的文章摘要，避免列表包含全部正文。

    Args:
        post: 已加载分类与标签的文章实体。

    Returns:
        可 JSON 序列化的摘要，包含状态与更新时间。
    """
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
    """在文章摘要中补充 Markdown 正文与公开地址标识。

    Args:
        post: 已加载分类与标签的文章实体。

    Returns:
        供模型分析或改写使用的完整文章数据。
    """
    return {**_summary(post), "content_markdown": post.content_markdown, "slug": post.slug}


def _list_posts() -> str:
    """校验博客所有者身份后，在独立会话中读取所有文章。

    Returns:
        按更新时间倒序排列的文章摘要 JSON，包含草稿与已发布文章。

    Raises:
        RuntimeError: 当前调用不具备博客所有者身份。
    """
    _owner_id()
    with SessionLocal() as session:
        posts = [_summary(post) for post in list_admin_posts(session)]
        return json.dumps(posts, ensure_ascii=False)


def _get_post(post_id: str) -> str:
    """校验身份与文章 ID 后读取文章详情。

    Args:
        post_id: 文章内部 UUID 字符串，不是 slug。

    Returns:
        包含正文的文章详情 JSON。

    Raises:
        RuntimeError: 当前调用不具备博客所有者身份。
        ValueError: post_id 格式无效或文章不存在。
    """
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
    """在所有状态的文章中搜索标题、摘要、正文与 slug。

    Args:
        query: 不区分大小写的 SQL ILIKE 搜索片段；百分号与下划线保留通配语义。

    Returns:
        按更新时间倒序排列的匹配文章摘要 JSON，无匹配时为 []。

    Raises:
        RuntimeError: 当前调用不具备博客所有者身份。
    """
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
    """检查提议基本条件并签名，将实际写入留给用户确认流程。

    此处检查目标是否存在及创建所需字段，不替代确认阶段的完整业务校验。
    令牌绑定用户、操作及载荷；不得在日志中输出令牌。

    Args:
        action: 待确认的博客写操作名称。
        payload: 操作参数，更新操作的 changes 留待确认阶段解析。
        settings: 提议签名配置与有效期。

    Returns:
        AgentActionProposal JSON，包含摘要、过期时间与确认令牌。

    Raises:
        RuntimeError: 当前调用不具备博客所有者身份。
        ValueError: 文章 ID 无效、目标不存在或创建草稿缺少必要字段。
    """
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
        if action == "create_draft":
            if any(not isinstance(payload.get(key), str) or not payload[key] for key in required):
                raise ValueError("创建草稿缺少必要字段")
            if get_blog_post_by_slug(session, str(payload["slug"])) is not None:
                raise ValueError(POST_SLUG_CONFLICT_MESSAGE)

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
    """使用 LangChain 原生装饰器创建博客工具集合。

    工具执行时读取运行时注入的身份；构建工具本身不读取文章或执行写操作。
    异步包装通过 to_thread 调用同步实现，避免数据库查询阻塞模型流式输出。

    Args:
        settings: 可选工具配置；None 时使用应用配置。

    Returns:
        九个可调用工具，包含只读工具与仅生成待确认提议的写工具。
    """
    runtime_settings = settings or get_settings()

    # 同步数据库操作交给工作线程，各次调用独立创建 Session，避免阻塞流式输出。
    # asyncio.to_thread 会传播调用上下文，权限校验仍能取得运行时注入的身份。
    @tool
    async def list_posts() -> str:
        """列出博客文章及其状态。

        Returns:
            所有文章的摘要 JSON，包含 ID、状态与更新时间，不包含正文。
        """
        return await asyncio.to_thread(_list_posts)

    @tool
    async def get_post(post_id: str) -> str:
        """读取指定文章的完整内容。

        Args:
            post_id: 从文章列表或上下文取得的文章 UUID 字符串。

        Returns:
            包含 Markdown 正文与 slug 的文章详情 JSON。
        """
        return await asyncio.to_thread(_get_post, post_id)

    @tool
    async def search_posts(query: str) -> str:
        """按标题、摘要、正文和 slug 搜索文章。

        Args:
            query: 要检索的内容片段，不区分大小写。

        Returns:
            匹配文章的摘要 JSON；无匹配时返回 []。
        """
        return await asyncio.to_thread(_search_posts, query)

    @tool
    async def analyze_post(post_id: str) -> str:
        """读取指定文章，供模型分析结构、表达与内容质量。

        Args:
            post_id: 待分析文章的 UUID 字符串。

        Returns:
            文章详情 JSON；分析结论由模型生成，工具本身不执行内容分析。
        """
        # 工具只读取正文，文章分析由模型结合返回内容完成。
        return await asyncio.to_thread(_get_post, post_id)

    @tool
    async def suggest_revision(post_id: str) -> str:
        """读取指定文章，供模型生成改写建议。

        Args:
            post_id: 待改写文章的 UUID 字符串。

        Returns:
            文章详情 JSON；采用建议时仍需调用写工具生成待确认提议。
        """
        # 改写建议由模型生成；采用建议时仍需走待确认的写操作。
        return await asyncio.to_thread(_get_post, post_id)

    @tool
    async def create_draft(
        title: str, excerpt: str, content_markdown: str, slug: str
    ) -> str:
        """为全新文章生成创建草稿的待确认操作，不直接写入数据库。

        补充、修订已有文章应使用 update_post，不要用同一 slug 再次创建。

        Args:
            title: 草稿标题，不能留空。
            excerpt: 草稿摘要，不能留空。
            content_markdown: 草稿 Markdown 正文，不能留空。
            slug: 未被任何文章或草稿占用的地址标识，完整格式由确认阶段校验。

        Returns:
            创建草稿的签名提议 JSON，必须交给用户确认后才能写入。
        """
        payload: dict[str, object] = {
            "title": title,
            "excerpt": excerpt,
            "content_markdown": content_markdown,
            "slug": slug,
        }
        return await asyncio.to_thread(_preview, "create_draft", payload, runtime_settings)

    @tool
    async def update_post(post_id: str, changes: str) -> str:
        """生成修改文章的待确认操作，不直接写入数据库。

        Args:
            post_id: 目标文章的 UUID 字符串。
            changes: 局部修改的 JSON 对象字符串，字段使用文章写入契约名称。
                例如 {"title": "新标题"}；确认时与当前数据库记录合并后校验。

        Returns:
            修改文章的签名提议 JSON，不表示文章已经修改。
        """
        return await asyncio.to_thread(
            _preview, "update_post", {"post_id": post_id, "changes": changes}, runtime_settings
        )

    @tool
    async def delete_post(post_id: str) -> str:
        """生成删除文章的待确认操作，不直接写入数据库。

        Args:
            post_id: 待删除文章的 UUID 字符串。

        Returns:
            删除文章的签名提议 JSON；删除必须由用户确认。
        """
        return await asyncio.to_thread(
            _preview, "delete_post", {"post_id": post_id}, runtime_settings
        )

    @tool
    async def publish_post(post_id: str) -> str:
        """生成发布文章的待确认操作，不直接写入数据库。

        Args:
            post_id: 待发布文章的 UUID 字符串。

        Returns:
            发布文章的签名提议 JSON；确认时仍须通过完整发布校验。
        """
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
