"""独立页面的数据契约，复用博客状态与时区处理。"""

from datetime import datetime
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from genesis_api.blog.comments import utc
from genesis_api.blog.models import BlogPage, BlogPostStatus


class PageWrite(BaseModel):
    """草稿允许未写完；发布必须有可阅读的标题与正文。"""

    model_config = ConfigDict(extra="forbid")
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=160)
    title: str = Field(max_length=200)
    excerpt: str = Field(default="", max_length=500)
    content_markdown: str = Field(max_length=200_000)
    status: BlogPostStatus = BlogPostStatus.DRAFT

    @field_validator("title", "excerpt", "content_markdown", mode="before")
    @classmethod
    def trim(cls, value: object) -> object:
        """文本去除首尾空白，保留正文内部排版。"""
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_publication(self) -> "PageWrite":
        """拒绝发布空标题或空正文，不替作者编造内容。"""
        if self.status == BlogPostStatus.PUBLISHED and not (self.title and self.content_markdown):
            raise ValueError("发布前请填写页面标题和正文")
        return self


class PageCreate(PageWrite):
    """客户端提供稳定 UUID，创建请求重试可以核对原有记录。"""

    id: UUID


class PageUpdate(PageWrite):
    """完整更新必须携带带时区的旧版本。"""

    expected_updated_at: AwareDatetime


class PagePreview(BaseModel):
    """公开目录不暴露作者标识、内部版本或草稿。"""

    id: UUID
    slug: str
    title: str
    excerpt: str


class PagePublic(PagePreview):
    """公开页面正文及真实发布时间。"""

    content_markdown: str
    published_at: datetime | None


class PageAdmin(PagePublic):
    """管理详情补充状态与版本，不与文章字段混用。"""

    status: BlogPostStatus
    created_at: datetime
    updated_at: datetime


class PageList(BaseModel):
    """公开目录分页，只包含公开元信息。"""

    items: list[PagePreview]
    total: int


class PageAdminList(BaseModel):
    """管理列表分页，复用管理详情契约。"""

    items: list[PageAdmin]
    total: int


def read_page(item: BlogPage) -> PageAdmin:
    """统一时区后投影业务字段，避免输出 ORM 的作者引用。"""
    return PageAdmin(
        id=item.id,
        slug=item.slug,
        title=item.title,
        excerpt=item.excerpt,
        content_markdown=item.content_markdown,
        status=item.status,
        published_at=utc(item.published_at) if item.published_at else None,
        created_at=utc(item.created_at),
        updated_at=utc(item.updated_at),
    )
