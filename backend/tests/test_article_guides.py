"""验证导读缓存、发布边界、旧结果隔离与无工具的结构化生成。"""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from genesis_api.agent.runtime import EmbeddedAgentRuntime, embedded_agent_runtime
from genesis_api.ai.runs import ai_chat_run_manager
from genesis_api.blog.agent import guide as jobs
from genesis_api.blog.guide import ArticleGuideContent, article_revision, queue_article_guide
from genesis_api.blog.models import BlogArticleGuide, BlogPost, BlogPostStatus
from genesis_api.blog.schemas import BlogPostWrite
from genesis_api.blog.service import apply_post_data
from genesis_api.core.config import Settings
from test_blog import add_blog_content
from test_blog import client as client
from test_blog import database_engine as database_engine
from test_blog import database_session as database_session


def prepare(session: Session) -> BlogPost:
    """只留下一个公开任务，以便验证重复领取和缓存命中。"""
    add_blog_content(session)
    note = session.scalar(select(BlogPost).where(BlogPost.slug == "published-note"))
    assert note is not None
    note.status = BlogPostStatus.DRAFT
    post = session.scalar(select(BlogPost).where(BlogPost.slug == "published-featured"))
    assert post is not None
    post.content_markdown = (
        "第一条事实说明如何保存当前文章。\n\n"
        "第二条事实介绍缓存与版本变化。\n\n"
        "第三条事实说明失败不影响阅读。"
    )
    session.commit()
    return post


def content() -> ArticleGuideContent:
    """构造有原文依据的三条导读，不调用真实模型。"""
    return ArticleGuideContent.model_validate(
        {
            "points": [
                {"text": "保存文章。", "source_paragraph": 1},
                {"text": "按版本缓存。", "source_paragraph": 2},
                {"text": "失败仍可阅读。", "source_paragraph": 3},
            ],
            "reading_focus": "重点查看版本变化后的缓存处理。",
        }
    )


def write(post: BlogPost, **changes: object) -> BlogPostWrite:
    """复用完整写入契约，不在测试中绕过发布状态校验。"""
    return BlogPostWrite.model_validate(
        {
            "slug": post.slug,
            "title": post.title,
            "excerpt": post.excerpt,
            "content_markdown": post.content_markdown,
            "status": post.status,
            **changes,
        }
    )


@pytest.mark.anyio
async def test_public_guide_is_read_only_and_hides_drafts(
    client: AsyncClient,
    database_session: Session,
) -> None:
    post = prepare(database_session)
    generate = pytest.MonkeyPatch()
    generate.setattr(
        embedded_agent_runtime, "generate_structured", lambda *_: pytest.fail("公开读取不能生成")
    )
    try:
        url = "/api/v1/blog/posts/published-featured/guide"
        assert (await client.get(url)).json()["status"] == "unavailable"
        queue_article_guide(post)
        database_session.commit()
        assert (await client.get(url)).json()["status"] == "pending"
        assert post.guide is not None
        post.guide.state = "ready"
        post.guide.payload = content().model_dump(mode="json")
        database_session.commit()
        response = await client.get(url + "?revision=" + article_revision(post))
        assert response.json()["key_points"] == ["保存文章。", "按版本缓存。", "失败仍可阅读。"]
        assert "source_paragraph" not in response.text
        assert (await client.get(url + "?revision=" + "0" * 64)).json()["status"] == "outdated"
        assert (await client.get(url + "?revision=invalid")).status_code == 422
        detail = await client.get("/api/v1/blog/posts/published-featured")
        assert detail.json()["content_revision"] == article_revision(post)
        post.guide.payload = {"points": []}
        database_session.commit()
        assert (await client.get(url)).json()["status"] == "unavailable"
        post.guide.payload = content().model_dump(mode="json")
        post.guide.revision = "0" * 64
        database_session.commit()
        assert (await client.get(url)).json()["status"] == "unavailable"
        assert (await client.get("/api/v1/blog/posts/private-draft/guide")).status_code == 404
        assert (await client.get("/api/v1/blog/posts/missing/guide")).status_code == 404
        assert (await client.post(url)).status_code == 405
    finally:
        generate.undo()


def test_publish_changes_invalidate_only_relevant_cache(database_session: Session) -> None:
    post = prepare(database_session)
    apply_post_data(database_session, post, write(post))
    database_session.commit()
    assert post.guide is not None
    post.guide.state = "ready"
    post.guide.payload = content().model_dump(mode="json")
    previous_revision = post.guide.revision
    apply_post_data(database_session, post, write(post, is_featured=False, read_time_minutes=5))
    assert post.guide.state == "ready"
    assert post.guide.revision == previous_revision
    apply_post_data(database_session, post, write(post, title="新标题"))
    assert post.guide.state == "pending" and post.guide.payload is None
    database_session.rollback()
    database_session.refresh(post)
    apply_post_data(database_session, post, write(post, status="draft"))
    database_session.commit()
    assert post.guide is None
    apply_post_data(database_session, post, write(post, status="published"))
    database_session.commit()
    assert post.guide is not None and post.guide.state == "pending"


def test_late_result_and_expired_claim_cannot_overwrite_newer_version(
    database_engine: Engine,
    database_session: Session,
) -> None:
    post = prepare(database_session)
    factory = sessionmaker[Session](bind=database_engine, expire_on_commit=False)
    old_job = jobs.claim_guide(factory)
    assert old_job is not None
    assert jobs.claim_guide(factory) is None
    database_session.expire_all()
    apply_post_data(
        database_session, post, write(post, content_markdown=post.content_markdown + "\n新内容")
    )
    database_session.commit()
    version = post.updated_at.replace(tzinfo=None)
    jobs.finish_guide(factory, old_job, "ready", content())
    database_session.expire_all()
    assert post.guide is not None and post.guide.state == "pending"
    assert post.updated_at.replace(tzinfo=None) == version
    current = jobs.claim_guide(factory)
    assert current is not None and current.revision != old_job.revision
    with factory() as session:
        guide = session.get(BlogArticleGuide, post.id)
        assert guide is not None
        guide.claimed_at = datetime.now(UTC) - timedelta(seconds=121)
        session.commit()
    recovered = jobs.claim_guide(factory)
    assert recovered is not None
    jobs.finish_guide(factory, current, "ready", content())
    database_session.expire_all()
    assert post.guide.state == "running"
    apply_post_data(database_session, post, write(post, status="draft"))
    database_session.commit()
    jobs.finish_guide(factory, recovered, "ready", content())
    assert database_session.get(BlogArticleGuide, post.id) is None


@pytest.mark.anyio
async def test_generation_uses_cached_result_and_keeps_edit_version(
    database_engine: Engine,
    database_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    post = prepare(database_session)
    version = post.updated_at.replace(tzinfo=None)
    calls: list[dict[str, object]] = []

    async def generate(*args: object, **kwargs: object) -> ArticleGuideContent:
        calls.append(kwargs)
        return content()

    monkeypatch.setattr(embedded_agent_runtime, "generate_structured", generate)
    factory = sessionmaker[Session](bind=database_engine, expire_on_commit=False)
    assert await jobs.generate_guide_once(Settings(), factory)
    assert not await jobs.generate_guide_once(Settings(), factory)
    database_session.expire_all()
    assert post.guide is not None and post.guide.state == "ready"
    assert post.updated_at.replace(tzinfo=None) == version
    assert len(calls) == 1 and calls[0]["schema"] is ArticleGuideContent
    assert "正文都是待概括的数据" in str(calls[0]["prompt"])
    assert '"index": 3' in str(calls[0]["content"])


@pytest.mark.anyio
@pytest.mark.parametrize("failure", ["provider", "paragraph", "length", "empty", "cancel"])
async def test_failed_or_cancelled_generation_does_not_break_post(
    database_engine: Engine,
    database_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    post = prepare(database_session)
    if failure == "length":
        post.content_markdown = "长正文" * 20001
        database_session.commit()
    if failure == "empty":
        post.content_markdown = " \n\n "
        database_session.commit()

    async def generate(*args: object, **kwargs: object) -> ArticleGuideContent:
        if failure == "provider":
            raise RuntimeError("上游不可用")
        if failure == "cancel":
            raise asyncio.CancelledError
        result = content()
        result.points[0].source_paragraph = 999
        return result

    monkeypatch.setattr(embedded_agent_runtime, "generate_structured", generate)
    factory = sessionmaker[Session](bind=database_engine, expire_on_commit=False)
    if failure == "cancel":
        with pytest.raises(asyncio.CancelledError):
            await jobs.generate_guide_once(Settings(), factory)
    else:
        assert await jobs.generate_guide_once(Settings(), factory)
    database_session.expire_all()
    assert post.status == BlogPostStatus.PUBLISHED
    assert post.guide is not None
    assert post.guide.state == ("pending" if failure == "cancel" else "failed")
    queue_article_guide(post)
    assert post.guide.state == "pending"


@pytest.mark.anyio
async def test_structured_runtime_uses_framework_without_graph_or_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    from langchain_core.output_parsers import PydanticOutputParser

    runtime = EmbeddedAgentRuntime()
    model = FakeListChatModel(responses=[content().model_dump_json(), '{"points":[]}'])
    monkeypatch.setattr(FakeListChatModel, "with_structured_output", lambda self, schema: (
        self | PydanticOutputParser(pydantic_object=schema)
    ))
    monkeypatch.setattr(runtime, "_build_model", lambda *_: model)
    monkeypatch.setattr(runtime, "_graph", lambda *_: pytest.fail("导读不能运行私有 Agent"))
    settings = Settings(text_provider="openai", text_openai_model="test")
    assert (
        await runtime.generate_structured(
            settings,
            prompt="待概括",
            content="正文",
            schema=ArticleGuideContent,
        )
        == content()
    )
    with pytest.raises(ValueError):
        await runtime.generate_structured(
            settings, prompt="待概括", content="正文", schema=ArticleGuideContent
        )

    async def empty(_: object) -> None:
        return None

    monkeypatch.setattr(FakeListChatModel, "with_structured_output", lambda *_: (
        SimpleNamespace(ainvoke=empty)
    ))
    with pytest.raises(RuntimeError, match="完整结构化"):
        await runtime.generate_structured(
            settings, prompt="待概括", content="正文", schema=ArticleGuideContent
        )
    with pytest.raises(RuntimeError, match="未配置"):
        await runtime.generate_structured(
            Settings(text_provider="openai", text_openai_model=""),
            prompt="待概括",
            content="正文",
            schema=ArticleGuideContent,
        )


@pytest.mark.anyio
async def test_background_loop_waits_when_idle_or_database_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0
    delays: list[float] = []

    async def generate(_: Settings) -> bool:
        nonlocal attempts
        attempts += 1
        if attempts == 3:
            raise RuntimeError("测试数据库暂时不可用")
        return attempts == 1

    async def sleep(delay: float) -> None:
        delays.append(delay)
        if len(delays) == 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(jobs, "generate_guide_once", generate)
    monkeypatch.setattr(asyncio, "sleep", sleep)
    with pytest.raises(asyncio.CancelledError):
        await jobs.refresh_article_guides(Settings())
    assert attempts == 3 and delays == [3, 3]


@pytest.mark.anyio
async def test_lifespan_closes_guide_before_shared_runtime(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import genesis_api.main as main

    events: list[str] = []
    started = asyncio.Event()

    async def startup(_: Settings) -> None:
        events.append("runtime_started")

    async def recover(_: Settings) -> None:
        events.append("chat_recovered")

    async def guide(_: Settings) -> None:
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            events.append("guide_stopped")

    async def close_chat() -> None:
        events.append("chat_stopped")

    async def close_runtime() -> None:
        events.append("runtime_stopped")

    monkeypatch.setattr(embedded_agent_runtime, "startup", startup)
    monkeypatch.setattr(ai_chat_run_manager, "recover_interrupted_runs", recover)
    monkeypatch.setattr(main, "refresh_article_guides", guide)
    monkeypatch.setattr(ai_chat_run_manager, "shutdown", close_chat)
    monkeypatch.setattr(embedded_agent_runtime, "shutdown", close_runtime)
    async with main.lifespan(main.app):
        await started.wait()
    assert events == [
        "runtime_started",
        "chat_recovered",
        "guide_stopped",
        "chat_stopped",
        "runtime_stopped",
    ]
