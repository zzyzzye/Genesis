"""博客 API 数据契约；复用 Pydantic 校验，ORM 实体通过 from_attributes 转换。"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from genesis_api.blog.models import BlogPostStatus


class BlogAuthor(BaseModel):
    """公开作者资料，只暴露文章展示需要的字段。"""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    handle: str
    display_name: str
    avatar_url: str | None


class BlogCategoryRead(BaseModel):
    """分类展示数据，供公开文章与后台使用。"""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str


class BlogCategoryWrite(BaseModel):
    """分类写入契约；名称用于展示，slug 用作稳定标识。"""

    name: str = Field(min_length=1, max_length=50)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value: str) -> str:
        # 在长度校验前去掉首尾空白，让纯空白名称按空值拒绝。
        return value.strip() if isinstance(value, str) else value


class BlogTagRead(BaseModel):
    """共享标签的展示数据。"""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str


class BlogPostPreview(BaseModel):
    """公开列表的文章摘要，不含正文；调用方须筛选已发布文章。"""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    title: str
    excerpt: str
    cover_image_url: str | None
    category: BlogCategoryRead | None
    is_featured: bool
    read_time_minutes: int
    published_at: datetime
    author: BlogAuthor
    tags: list[BlogTagRead]


class BlogPostDetail(BlogPostPreview):
    """公开文章详情，在摘要字段上补充 Markdown 正文。"""

    content_markdown: str


class BlogPostListResponse(BaseModel):
    """分页响应；total 表示符合筛选条件的总数，而非当前页数量。"""

    items: list[BlogPostPreview]
    total: int


class BlogTagWrite(BaseModel):
    """标签写入契约，也用于文章写入时解析关联标签。"""

    name: str = Field(min_length=1, max_length=50)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value: str) -> str:
        # 与分类名称采用相同的空白处理，保留名称内部空格。
        return value.strip() if isinstance(value, str) else value


class BlogPostWrite(BaseModel):
    """完整文章写入契约，供人工编辑和 Agent 确认写入共同校验。

    局部更新须由调用方先合并已有字段；草稿允许不完整内容，发布时校验正文。
    """

    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=160)
    title: str = Field(max_length=200)
    excerpt: str = Field(max_length=500)
    content_markdown: str
    cover_image_url: str | None = Field(default=None, max_length=500)
    category_id: UUID | None = None
    status: BlogPostStatus = BlogPostStatus.DRAFT
    is_featured: bool = False
    read_time_minutes: int = Field(default=1, ge=1, le=120)
    published_at: datetime | None = None
    # 由后台路由与数据库版本比对，模型本身不检查并发冲突，也不持久化此字段。
    expected_updated_at: datetime | None = None
    tags: list[BlogTagWrite] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def published_posts_require_content(self) -> "BlogPostWrite":
        # 草稿可以暂缺内容；公开发布仍必须具备可阅读的标题、摘要和正文。
        if self.status is BlogPostStatus.PUBLISHED and not all(
            value.strip() for value in (self.title, self.excerpt, self.content_markdown)
        ):
            raise ValueError("发布前请填写标题、摘要和正文")
        return self

    @field_validator("tags")
    @classmethod
    def tags_must_have_unique_slugs(cls, tags: list[BlogTagWrite]) -> list[BlogTagWrite]:
        # 同一请求不能重复引用一个标签；数据库唯一性另由持久化约束保证。
        if len({tag.slug for tag in tags}) != len(tags):
            raise ValueError("标签 slug 不能重复")
        return tags


class BlogPostAdminRead(BaseModel):
    """后台文章数据，包含草稿状态、正文与并发编辑所需的更新时间。"""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    title: str
    excerpt: str
    content_markdown: str
    cover_image_url: str | None
    category_id: UUID | None
    category: BlogCategoryRead | None
    status: BlogPostStatus
    is_featured: bool
    read_time_minutes: int
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    author: BlogAuthor
    tags: list[BlogTagRead]
