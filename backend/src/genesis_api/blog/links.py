"""博客链接契约与查询；复用现有数据库会话和作者权限依赖。"""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, HttpUrl, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from genesis_api.blog.models import BlogLink


class BlogLinkWrite(BaseModel):
    """链接写入数据；链接默认隐藏，排序值越小越靠前。"""

    name: str = Field(min_length=1, max_length=80)
    url: HttpUrl = Field(max_length=2048)
    description: str = Field(default="", max_length=240)
    sort_order: int = Field(default=0, ge=0, le=9999, strict=True)
    is_visible: bool = False

    @field_validator("name", "description", "url", mode="before")
    @classmethod
    def trim_text(cls, value: object) -> object:
        """在长度与 URL 校验前移除首尾空白。"""
        return value.strip() if isinstance(value, str) else value

    @field_validator("url")
    @classmethod
    def reject_credentials(cls, value: HttpUrl) -> HttpUrl:
        """拒绝包含账号或密码的链接，避免保存和公开凭据。"""
        if value.username is not None or value.password is not None:
            raise ValueError("链接不能包含账号或密码")
        return value


class BlogLinkUpdate(BlogLinkWrite):
    """更新须携带读取时的版本，避免覆盖其他标签页的修改。"""

    expected_updated_at: AwareDatetime


class BlogLinkPublic(BaseModel):
    """公开链接只包含展示字段，不暴露后台状态与版本。"""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    url: str
    description: str


class BlogLinkRead(BlogLinkPublic):
    """后台链接补充排序、可见状态与并发版本。"""

    sort_order: int
    is_visible: bool
    updated_at: datetime

    @field_validator("updated_at")
    @classmethod
    def normalize_version(cls, value: datetime) -> datetime:
        """统一返回 UTC 版本，兼容测试数据库不保留时区的行为。"""
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class BlogLinkList(BaseModel):
    """公开链接分页响应。"""

    items: list[BlogLinkPublic]
    total: int


class BlogLinkAdminList(BaseModel):
    """作者链接分页响应，total 为筛选后的数量。"""

    items: list[BlogLinkRead]
    total: int


def list_links(
    session: Session, *, limit: int, offset: int, query: str = "", visible: bool | None = None
) -> tuple[list[BlogLink], int]:
    """按排序值、名称和 ID 稳定分页，搜索内容按字面量匹配。

    Args:
        session: 当前请求的数据库会话。
        limit: 每页上限，由路由校验。
        offset: 非负分页偏移。
        query: 名称、描述或 URL 的搜索词。
        visible: True 仅公开项，False 仅隐藏项，None 为全部。

    Returns:
        当前页链接与筛选后总数。
    """
    statement = select(BlogLink)
    if visible is not None:
        statement = statement.where(BlogLink.is_visible == visible)
    if query.strip():
        search = query.strip()
        statement = statement.where(
            BlogLink.name.icontains(search, autoescape=True)
            | BlogLink.description.icontains(search, autoescape=True)
            | BlogLink.url.icontains(search, autoescape=True)
        )
    total = session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    items = session.scalars(
        statement.order_by(BlogLink.sort_order, BlogLink.name, BlogLink.id)
        .offset(offset)
        .limit(limit)
    ).all()
    return list(items), total


def locked_link(session: Session, link_id: UUID, expected: datetime) -> BlogLink:
    """锁定并核对链接版本，不存在返回 404，版本过期返回 409。"""
    item = session.scalar(select(BlogLink).where(BlogLink.id == link_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=404, detail="链接不存在")
    actual = BlogLinkRead.normalize_version(item.updated_at)
    if actual != expected.astimezone(UTC):
        raise HTTPException(status_code=409, detail="链接已被修改，请重新加载后再操作")
    return item


def apply_link(item: BlogLink, data: BlogLinkWrite) -> None:
    """应用已验证字段并生成新版本，不在此处提交事务。"""
    item.name = data.name
    item.url = str(data.url)
    item.description = data.description
    item.sort_order = data.sort_order
    item.is_visible = data.is_visible
    item.updated_at = datetime.now(UTC)
