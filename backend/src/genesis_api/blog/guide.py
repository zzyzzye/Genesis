"""文章导读的内容契约、版本指纹与发布事务内的缓存失效规则。"""

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from genesis_api.blog.models import BlogArticleGuide, BlogPost, BlogPostStatus


class GuidePoint(BaseModel):
    """一条导读要点及原文段落编号，正文按普通文本展示。"""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    text: str = Field(min_length=1, max_length=180)
    source_paragraph: int = Field(ge=1)


class ArticleGuideContent(BaseModel):
    """模型必须提供三个有原文依据的要点与一个具体阅读重点。"""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    points: list[GuidePoint] = Field(min_length=3, max_length=3)
    reading_focus: str = Field(min_length=1, max_length=120)


class ArticleGuideRead(BaseModel):
    """公开端只读取缓存，不通过匿名访问触发模型生成。"""

    status: Literal["pending", "ready", "unavailable", "outdated"]
    key_points: list[str] = Field(default_factory=list)
    reading_focus: str = ""


def article_revision(post: BlogPost) -> str:
    """为参与导读的标题、摘要与正文生成指纹，不依赖标签和编辑时间。"""
    source = json.dumps([post.title, post.excerpt, post.content_markdown], ensure_ascii=False)
    return hashlib.sha256(source.encode()).hexdigest()


def queue_article_guide(post: BlogPost) -> None:
    """发布时准备导读，正文变更失效缓存；草稿不生成且不保留公开导读。

    不提交事务、不调用模型；人工编辑和 Agent 写入均经过此入口。
    仅修改非正文元数据时复用已有导读，失败后再次保存可重新尝试。
    """
    if post.status != BlogPostStatus.PUBLISHED:
        post.guide = None
        return
    revision = article_revision(post)
    if post.guide is None:
        post.guide = BlogArticleGuide(revision=revision, state="pending")
    elif post.guide.revision != revision or post.guide.state == "failed":
        post.guide.revision = revision
        post.guide.state = "pending"
        post.guide.payload = None
        post.guide.claimed_at = None
        post.guide.generated_at = None
