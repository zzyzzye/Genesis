"""发布导读的缓存刷新任务；模型和结构化解析统一复用公共运行时。"""

import asyncio
import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from genesis_api.agent.runtime import embedded_agent_runtime
from genesis_api.blog.agent.prompt import ARTICLE_GUIDE_PROMPT
from genesis_api.blog.guide import ArticleGuideContent, queue_article_guide
from genesis_api.blog.models import BlogArticleGuide, BlogPost, BlogPostStatus
from genesis_api.core.config import Settings
from genesis_api.database.session import SessionLocal

logger = logging.getLogger(__name__)
SessionFactory = Callable[[], Session]


@dataclass(frozen=True)
class GuideJob:
    """一次已领取的不可变正文快照，领取时间用于阻止迟到结果覆盖新任务。"""

    post_id: UUID
    revision: str
    claimed_at: datetime
    title: str
    excerpt: str
    content: str


def claim_guide(session_factory: SessionFactory) -> GuideJob | None:
    """补齐旧文章并领取一个任务；行锁跳过其他执行者，过期领取可恢复。

    每次最多补齐 20 篇旧文章。模型调用最长 60 秒，领取 120 秒后可重新领取，
    进程重启不会把中断任务永远留在运行中，也不会立即抢占其他进程的任务。
    """
    with session_factory() as session:
        missing = session.scalars(
            select(BlogPost)
            .outerjoin(BlogArticleGuide)
            .where(BlogPost.status == BlogPostStatus.PUBLISHED, BlogArticleGuide.post_id.is_(None))
            .order_by(BlogPost.published_at.desc())
            .limit(20)
            .with_for_update(of=BlogPost, skip_locked=True)
        )
        for missing_post in missing:
            queue_article_guide(missing_post)
        session.commit()

        now = datetime.now(UTC)
        guide = session.scalar(
            select(BlogArticleGuide)
            .join(BlogPost)
            .where(
                BlogPost.status == BlogPostStatus.PUBLISHED,
                or_(
                    BlogArticleGuide.state == "pending",
                    (BlogArticleGuide.state == "running")
                    & (BlogArticleGuide.claimed_at < now - timedelta(seconds=120)),
                ),
            )
            .order_by(BlogPost.published_at.desc())
            .limit(1)
            .with_for_update(of=BlogArticleGuide, skip_locked=True)
        )
        if guide is None:
            return None
        post = session.get(BlogPost, guide.post_id)
        assert post is not None
        guide.state = "running"
        guide.claimed_at = now
        job = GuideJob(
            post.id, guide.revision, now, post.title, post.excerpt, post.content_markdown
        )
        session.commit()
        return job


def finish_guide(
    session_factory: SessionFactory,
    job: GuideJob,
    state: str,
    content: ArticleGuideContent | None = None,
) -> None:
    """按内容指纹与领取时间提交缓存，不修改文章的并发编辑版本。

    文章已更新、撤回或删除时不接受旧结果。取消任务恢复为待处理；
    普通失败保留失败状态，作者下次保存已发布文章时可以重新生成。
    """
    with session_factory() as session:
        session.execute(
            update(BlogArticleGuide)
            .where(
                BlogArticleGuide.post_id == job.post_id,
                BlogArticleGuide.revision == job.revision,
                BlogArticleGuide.claimed_at == job.claimed_at,
                BlogArticleGuide.state == "running",
                select(BlogPost.id)
                .where(
                    BlogPost.id == job.post_id,
                    BlogPost.status == BlogPostStatus.PUBLISHED,
                )
                .exists(),
            )
            .values(
                state=state,
                payload=content.model_dump(mode="json") if content else None,
                generated_at=datetime.now(UTC) if content else None,
                claimed_at=None,
            )
        )
        session.commit()


async def generate_guide_once(
    settings: Settings,
    session_factory: SessionFactory = SessionLocal,
) -> bool:
    """处理一个待刷新导读；返回是否领取任务，失败不影响文章发布。

    只将文章文本交给无工具的结构化生成，不读取链接、附件或作者资料。
    超长正文暂不生成，避免截取局部内容却声称已概括全文。
    """
    job = await asyncio.to_thread(claim_guide, session_factory)
    if job is None:
        return False
    try:
        if len(job.content) > 60000:
            raise ValueError("文章超过当前导读处理长度")
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", job.content) if part.strip()]
        if not paragraphs:
            raise ValueError("文章没有可供导读的正文")
        async with asyncio.timeout(60):
            content = await embedded_agent_runtime.generate_structured(
                settings,
                prompt=ARTICLE_GUIDE_PROMPT,
                content=json.dumps(
                    {
                        "title": job.title,
                        "excerpt": job.excerpt,
                        "paragraphs": [
                            {"index": index, "content": paragraph}
                            for index, paragraph in enumerate(paragraphs, 1)
                        ],
                    },
                    ensure_ascii=False,
                ),
                schema=ArticleGuideContent,
            )
        if any(point.source_paragraph > len(paragraphs) for point in content.points):
            raise ValueError("导读依据未出现在原文中")
    except asyncio.CancelledError:
        await asyncio.to_thread(finish_guide, session_factory, job, "pending")
        raise
    except Exception:
        # 不输出模型异常正文、提示词或配置，避免把上游信息带入日志。
        logger.warning("文章导读生成未完成，post_id=%s", job.post_id)
        await asyncio.to_thread(finish_guide, session_factory, job, "failed")
    else:
        await asyncio.to_thread(finish_guide, session_factory, job, "ready", content)
    return True


async def refresh_article_guides(settings: Settings) -> None:
    """应用生命周期内串行刷新持久化缓存，不建立另一套 Agent 或对话任务框架。"""
    while True:
        try:
            worked = await generate_guide_once(settings)
        except Exception:
            logger.warning("文章导读缓存暂时无法刷新，稍后重试")
            worked = False
        if not worked:
            await asyncio.sleep(3)
