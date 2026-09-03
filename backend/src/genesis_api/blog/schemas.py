from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from genesis_api.blog.models import BlogPostStatus


class BlogAuthor(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    handle: str
    display_name: str
    avatar_url: str | None


class BlogTagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str


class BlogPostPreview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    title: str
    excerpt: str
    cover_image_url: str | None
    is_featured: bool
    read_time_minutes: int
    published_at: datetime
    author: BlogAuthor
    tags: list[BlogTagRead]


class BlogPostDetail(BlogPostPreview):
    content_markdown: str


class BlogPostListResponse(BaseModel):
    items: list[BlogPostPreview]
    total: int


class BlogTagWrite(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)


class BlogPostWrite(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=160)
    title: str = Field(min_length=1, max_length=200)
    excerpt: str = Field(min_length=1, max_length=500)
    content_markdown: str = Field(min_length=1)
    cover_image_url: str | None = Field(default=None, max_length=500)
    status: BlogPostStatus = BlogPostStatus.DRAFT
    is_featured: bool = False
    read_time_minutes: int = Field(default=1, ge=1, le=120)
    published_at: datetime | None = None
    tags: list[BlogTagWrite] = Field(default_factory=list, max_length=10)

    @field_validator("tags")
    @classmethod
    def tags_must_have_unique_slugs(cls, tags: list[BlogTagWrite]) -> list[BlogTagWrite]:
        if len({tag.slug for tag in tags}) != len(tags):
            raise ValueError("标签 slug 不能重复")
        return tags


class BlogPostAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    title: str
    excerpt: str
    content_markdown: str
    cover_image_url: str | None
    status: BlogPostStatus
    is_featured: bool
    read_time_minutes: int
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    author: BlogAuthor
    tags: list[BlogTagRead]
