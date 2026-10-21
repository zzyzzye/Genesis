"""博客 Agent 的 LangChain 工具：按可信策略审阅或执行博客操作。

带 @tool 的函数文档也会提供给模型作为工具说明，参数含义与权限边界须准确。
同步数据库操作在独立工作线程中执行，每次调用创建自己的会话。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Literal, cast
from uuid import UUID, uuid4

from fastapi import HTTPException
from jwt import encode
from langchain_core.tools import BaseTool, ToolException, tool
from pydantic import BaseModel, ConfigDict, ValidationError, create_model
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from genesis_api.agent.context import automatic_actions_allowed, require_owner
from genesis_api.agent.contracts import AgentActionProposal
from genesis_api.blog.agent.actions import (
    check_post_references,
    check_post_version,
    confirm_blog_action,
    post_write_data,
)
from genesis_api.blog.comments import utc
from genesis_api.blog.models import BlogCategory, BlogPost, BlogTag
from genesis_api.blog.schemas import BlogTagWrite
from genesis_api.blog.service import (
    POST_SLUG_CONFLICT_MESSAGE,
    get_blog_post_by_id,
    get_blog_post_by_slug,
    list_admin_categories,
    list_admin_posts,
    list_admin_tags,
)
from genesis_api.core.config import Settings, get_settings
from genesis_api.database.session import SessionLocal
from genesis_api.identity.models import User, UserRole

BlogAgentAction = Literal[
    "create_draft", "create_and_publish", "update_post", "delete_post", "publish_post"
]
async def _invoke[**P](operation: Callable[P, str], *args: P.args, **kwargs: P.kwargs) -> str:
    """让可修正的业务错误成为 LangChain 工具回执，不中断整轮 Agent 执行。"""
    try:
        return await asyncio.to_thread(operation, *args, **kwargs)
    except HTTPException as exc:
        raise ToolException(str(exc.detail)) from None
    except ValidationError as exc:
        # 只回报字段与原因，不在工具错误中复述文章正文或其他输入值。
        reasons = [f"{'.'.join(map(str, error['loc'])) or '文章'}：" + (
            "时间必须包含时区偏移" if error["type"] == "timezone_aware" else error["msg"]
        )
                   for error in exc.errors(include_input=False, include_url=False)]
        raise ToolException("参数校验失败：" + "；".join(reasons)) from None
    except ValueError as exc:
        raise ToolException(str(exc)) from None


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
        "updated_at": utc(post.updated_at).isoformat(),
        "scheduled_at": utc(post.scheduled_at).isoformat() if post.scheduled_at else None,
        "slug": post.slug,
        "category": post.category.name if post.category else None,
        "categories": [category.name for category in getattr(post, "categories", [])],
        "category_ids": [str(category.id) for category in post.categories],
        "tags": [tag.slug for tag in post.tags],
    }


def _detail(post: BlogPost) -> dict[str, object]:
    """在文章摘要中补充 Markdown 正文与公开地址标识。

    Args:
        post: 已加载分类与标签的文章实体。

    Returns:
        供模型分析或改写使用的完整文章数据。
    """
    return {
        **_summary(post), "content_markdown": post.content_markdown,
        "tag_details": [{"name": tag.name, "slug": tag.slug} for tag in post.tags],
        "cover_image_url": post.cover_image_url, "is_featured": post.is_featured,
        "read_time_minutes": post.read_time_minutes,
        "published_at": utc(post.published_at).isoformat() if post.published_at else None,
    }


def _list_taxonomies() -> str:
    """读取真实分类和共享标签，供模型引用稳定标识及原有名称。"""
    _owner_id()
    with SessionLocal() as session:
        return json.dumps({
            "categories": [{"id": str(item.id), "name": item.name, "slug": item.slug}
                           for item in list_admin_categories(session)],
            "tags": [{"id": str(item.id), "name": item.name, "slug": item.slug}
                     for item in list_admin_tags(session)],
        }, ensure_ascii=False)


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
        query: 不区分大小写的普通文本，同时匹配文章、分类和标签，不解释通配符。

    Returns:
        按更新时间倒序排列的匹配文章摘要 JSON，无匹配时为 []。

    Raises:
        RuntimeError: 当前调用不具备博客所有者身份。
    """
    _owner_id()
    query = query.strip()
    with SessionLocal() as session:
        posts = session.scalars(
            select(BlogPost)
            .where(
                BlogPost.deleted_at.is_(None),
                or_(
                    BlogPost.title.icontains(query, autoescape=True),
                    BlogPost.excerpt.icontains(query, autoescape=True),
                    BlogPost.content_markdown.icontains(query, autoescape=True),
                    BlogPost.slug.icontains(query, autoescape=True),
                    BlogPost.tags.any(BlogTag.name.icontains(query, autoescape=True)),
                    BlogPost.tags.any(BlogTag.slug.icontains(query, autoescape=True)),
                    BlogPost.categories.any(BlogCategory.name.icontains(query, autoescape=True)),
                )
            )
            .options(selectinload(BlogPost.category), selectinload(BlogPost.tags))
            .order_by(BlogPost.updated_at.desc())
        )
        return json.dumps([_summary(post) for post in posts], ensure_ascii=False)


def _preview(action: BlogAgentAction, payload: dict[str, object], settings: Settings) -> str:
    """校验并签名博客操作，按可信上下文审阅或自动执行。

    此处预检版本、完整写入契约与关联数据；确认阶段仍重新读取并校验。
    令牌绑定用户、操作及载荷；不得在日志中输出令牌。

    Args:
        action: 待确认的博客写操作名称。
        payload: 操作参数，更新操作的 changes 留待确认阶段解析。
        settings: 提议签名配置与有效期。

    Returns:
        操作提议 JSON；自动模式额外包含真实执行回执。

    Raises:
        RuntimeError: 当前调用不具备博客所有者身份。
        ValueError: 文章 ID 无效、目标不存在或创建草稿缺少必要字段。
    """
    actor_id = _owner_id()
    with SessionLocal() as session:
        post = None
        if action in {"update_post", "delete_post", "publish_post"}:
            try:
                post_id = UUID(str(payload.get("post_id")))
            except (TypeError, ValueError) as exc:
                raise ValueError("post_id 无效") from exc
            post = get_blog_post_by_id(session, post_id)
            if post is None:
                raise ValueError("文章不存在")
            check_post_version(post, payload.get("expected_updated_at"))
            if payload.get("cancel_schedule") and post.scheduled_at is None:
                raise ValueError("该文章当前没有定时发布计划，无需取消。")
            # 在操作前保留可信标题，删除后与历史恢复时仍能识别目标文章。
            payload = {**payload, "target_title": post.title,
                       "target_status": post.status.value,
                       "expected_updated_at": utc(post.updated_at).isoformat()}
        if action != "delete_post":
            data = post_write_data(action, payload, post)
            names = check_post_references(session, data)
            existing = get_blog_post_by_slug(session, data.slug)
            if existing is not None and (post is None or existing.id != post.id):
                raise ValueError(POST_SLUG_CONFLICT_MESSAGE)
            payload = {**payload, "category_names": names}
            if action == "update_post":
                changes = payload["changes"]
                payload["changes"] = json.loads(changes) if isinstance(changes, str) else changes

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
    if automatic_actions_allowed():
        with SessionLocal() as session:
            owner = session.get(User, actor_id)
            if owner is None or owner.role != UserRole.OWNER:
                raise RuntimeError("自动执行需要有效的站点所有者身份")
            result = confirm_blog_action(action, payload, current_user=owner, session=session)
            proposal.executed = True
            proposal.execution_result = cast(dict[str, object], result)
    return proposal.model_dump_json()


def build_blog_tools(settings: Settings | None = None) -> list[BaseTool]:
    """使用 LangChain 原生装饰器创建博客工具集合。

    工具执行时读取运行时注入的身份；构建工具本身不读取文章或执行写操作。
    异步包装通过 to_thread 调用同步实现，避免数据库查询阻塞模型流式输出。

    Args:
        settings: 可选工具配置；None 时使用应用配置。

    Returns:
        博客工具集合，写操作按可信执行策略审阅或自动执行。
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
        return await _invoke(_list_posts)

    @tool
    async def list_taxonomies() -> str:
        """列出已有分类和标签，包含真实 ID、名称和 slug。

        为文章选择分类前先调用；分类只可引用已有 ID，标签可复用或新建。
        复用标签时沿用原名称，不通过文章操作修改共享标签名称。
        """
        return await _invoke(_list_taxonomies)

    @tool
    async def get_post(post_id: str) -> str:
        """读取指定文章的完整内容。

        Args:
            post_id: 从文章列表或上下文取得的文章 UUID 字符串。

        Returns:
            包含 Markdown 正文与 slug 的文章详情 JSON。
        """
        return await _invoke(_get_post, post_id)

    @tool
    async def search_posts(query: str) -> str:
        """按标题、摘要、正文、slug、分类和标签搜索文章。

        Args:
            query: 要检索的内容片段，不区分大小写。

        Returns:
            匹配文章的摘要 JSON；无匹配时返回 []。
        """
        return await _invoke(_search_posts, query)

    @tool
    async def analyze_post(post_id: str) -> str:
        """读取指定文章，供模型分析结构、表达与内容质量。

        Args:
            post_id: 待分析文章的 UUID 字符串。

        Returns:
            文章详情 JSON；分析结论由模型生成，工具本身不执行内容分析。
        """
        # 工具只读取正文，文章分析由模型结合返回内容完成。
        return await _invoke(_get_post, post_id)

    @tool
    async def suggest_revision(post_id: str) -> str:
        """读取指定文章，供模型生成改写建议。

        Args:
            post_id: 待改写文章的 UUID 字符串。

        Returns:
            文章详情 JSON；采用建议时仍需调用写工具，遵循当前执行策略。
        """
        # 改写建议由模型生成；采用建议时仍需走业务写工具。
        return await _invoke(_get_post, post_id)

    @tool
    async def create_draft(
        title: str, excerpt: str, content_markdown: str, slug: str,
        category_ids: list[str] | None = None, tags: list[BlogTagWrite] | None = None,
        cover_image_url: str | None = None,
    ) -> str:
        """创建新草稿，可同时设置分类、标签和封面；定时发布请用 create_scheduled_post。

        补充、修订已有文章应使用 update_post，不要用同一 slug 再次创建。

        Args:
            title: 草稿标题，不能留空。
            excerpt: 草稿摘要，不能留空。
            content_markdown: 草稿 Markdown 正文，不能留空。
            slug: 未被任何文章或草稿占用的地址标识，完整格式由确认阶段校验。
            category_ids: 从 list_taxonomies 取得的分类 ID，支持多选。
            tags: 标签名称和 slug 列表，最多十个；已有 slug 沿用原名称。
            cover_image_url: 可选封面地址。

        Returns:
            审阅模式返回签名提议，自动模式返回执行回执。
        """
        payload: dict[str, object] = {
            "title": title,
            "excerpt": excerpt,
            "content_markdown": content_markdown,
            "slug": slug,
            "category_ids": category_ids, "tags": [tag.model_dump() for tag in tags or []],
            "cover_image_url": cover_image_url,
        }
        return await _invoke(_preview, "create_draft", payload, runtime_settings)

    @tool
    async def create_scheduled_post(
        title: str, excerpt: str, content_markdown: str, slug: str, scheduled_at: str,
        category_ids: list[str], tags: list[BlogTagWrite],
        cover_image_url: str | None = None,
    ) -> str:
        """一次创建文章并安排定时发布，用户要求未来发布新文章时必须使用。

        Args:
            title: 完整文章标题。
            excerpt: 文章摘要。
            content_markdown: 完整 Markdown 正文。
            slug: 尚未被任何文章占用的地址标识。
            scheduled_at: 必填未来发布时间，使用含时区偏移的 ISO 8601 时间。
            category_ids: 先读取 list_taxonomies 后选择已有分类 ID，无分类时明确传空列表。
            tags: 先读取 list_taxonomies 后选择标签，最多十个；无标签时明确传空列表。
            cover_image_url: 可选封面地址。

        Returns:
            审阅时返回一次确认的完整计划；自动时返回已保存计划的真实回执。
        """
        return await _invoke(_preview, "create_draft", {
            "title": title, "excerpt": excerpt, "content_markdown": content_markdown, "slug": slug,
            "scheduled_at": scheduled_at, "category_ids": category_ids,
            "tags": [tag.model_dump() for tag in tags or []], "cover_image_url": cover_image_url,
        }, runtime_settings)

    @tool
    async def create_and_publish(
        title: str, excerpt: str, content_markdown: str, slug: str,
        category_ids: list[str] | None = None, tags: list[BlogTagWrite] | None = None,
        cover_image_url: str | None = None,
    ) -> str:
        """一次创建并发布全新文章；用户要求直接发布时使用，不要拆成创建草稿和再次发布。

        Args:
            title: 最终文章标题。
            excerpt: 最终文章摘要。
            content_markdown: 完整 Markdown 正文。
            slug: 尚未占用的文章地址标识。
            category_ids: 已有分类 ID，支持多选。
            tags: 标签名称和 slug 列表，最多十个；已有 slug 沿用原名称。
            cover_image_url: 可选封面地址。

        Returns:
            审阅模式返回一次性发布提议；自动模式返回已执行的发布结果。
        """
        return await _invoke(_preview, "create_and_publish", {
            "title": title, "excerpt": excerpt, "content_markdown": content_markdown, "slug": slug,
            "category_ids": category_ids, "tags": [tag.model_dump() for tag in tags or []],
            "cover_image_url": cover_image_url,
        }, runtime_settings)

    @tool
    async def update_post(
        post_id: str, changes: str, expected_updated_at: str,
    ) -> str:
        """修改文章内容、分类标签或发布计划，按当前执行策略审阅或执行。

        Args:
            post_id: 目标文章的 UUID 字符串。
            changes: 局部修改的 JSON 对象字符串，字段使用文章写入契约名称。
                支持 title、excerpt、content_markdown、slug、category_ids、tags、
                cover_image_url、is_featured、read_time_minutes、status、published_at、scheduled_at。
                定时发布使用 {"status":"draft","scheduled_at":"2099-01-01T09:00:00+08:00"}；
                取消计划用 {"scheduled_at":null}；立即发布用 {"status":"published"}。
                撤回并取消计划用 {"status":"draft","scheduled_at":null}。
                空分类/标签列表清空关联，省略字段保留原值；确认时重新校验。
            expected_updated_at: 从 get_post 原样取得的 updated_at，防止覆盖较新版本。

        Returns:
            审阅模式返回签名提议，自动模式返回真实执行回执。
        """
        return await _invoke(
            _preview, "update_post", {"post_id": post_id, "changes": changes,
                                     "expected_updated_at": expected_updated_at}, runtime_settings
        )

    @tool
    async def schedule_post(
        post_id: str, scheduled_at: str, expected_updated_at: str,
    ) -> str:
        """为已有文章安排定时发布；保持原内容，当前公开文章将先撤回为草稿。

        Args:
            post_id: 先通过 get_post 确认的目标文章 UUID。
            scheduled_at: 必填未来发布时间，使用含时区偏移的 ISO 8601 时间。
            expected_updated_at: 从 get_post 原样取得的 updated_at。

        Returns:
            审阅时返回发布计划提议，自动时保存计划并返回真实回执。
        """
        return await _invoke(_preview, "update_post", {
            "post_id": post_id, "expected_updated_at": expected_updated_at,
            "changes": {"status": "draft", "scheduled_at": scheduled_at},
        }, runtime_settings)

    @tool
    async def cancel_post_schedule(post_id: str, expected_updated_at: str) -> str:
        """取消指定文章的发布计划，保留正文、分类标签与草稿状态。

        Args:
            post_id: 先通过 get_post 确认具有定时计划的文章 UUID。
            expected_updated_at: 从 get_post 原样取得的 updated_at。

        Returns:
            审阅时返回取消计划提议，自动时直接取消并返回真实回执。
        """
        return await _invoke(_preview, "update_post", {
            "post_id": post_id, "expected_updated_at": expected_updated_at,
            "changes": {"scheduled_at": None}, "cancel_schedule": True,
        }, runtime_settings)

    @tool
    async def delete_post(post_id: str, expected_updated_at: str) -> str:
        """将文章移入回收站，保留正文和评论，可在文章管理中恢复为草稿。

        Args:
            post_id: 待删除文章的 UUID 字符串。
            expected_updated_at: 从 get_post 取得的 updated_at，防止删除已变更的文章。

        Returns:
            审阅模式返回签名提议；自动模式返回已移入回收站的执行回执。
        """
        return await _invoke(
            _preview, "delete_post", {"post_id": post_id,
                                     "expected_updated_at": expected_updated_at}, runtime_settings
        )

    @tool
    async def publish_post(post_id: str, expected_updated_at: str) -> str:
        """生成发布文章的待确认操作，不直接写入数据库。

        Args:
            post_id: 待发布文章的 UUID 字符串。
            expected_updated_at: 从 get_post 取得的 updated_at，防止公开已变更的正文。

        Returns:
            审阅模式返回签名提议；自动模式直接执行，均须通过完整发布校验。
        """
        return await _invoke(
            _preview, "publish_post", {"post_id": post_id,
                                      "expected_updated_at": expected_updated_at}, runtime_settings
        )

    tools = [
        list_posts,
        list_taxonomies,
        get_post,
        search_posts,
        analyze_post,
        suggest_revision,
        create_draft,
        create_scheduled_post,
        create_and_publish,
        update_post,
        schedule_post,
        cancel_post_schedule,
        delete_post,
        publish_post,
    ]
    for item in tools:
        schema = item.args_schema
        if isinstance(schema, type) and issubclass(schema, BaseModel):
            # 工具参数也拒绝未知字段，避免把误传的定时参数忽略后立即发布。
            item.args_schema = create_model(schema.__name__, __base__=schema,
                                            __config__=ConfigDict(extra="forbid"))
        item.handle_tool_error = True
        item.handle_validation_error = (
            "参数无效，请按工具定义提供完整且正确的字段，不要传入未声明的参数。"
        )
    return tools
