"""账号注册、登录与个人资料接口，凭据不会出现在公开用户资料中。"""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from genesis_api.api.dependencies import CurrentUserDependency, SessionDependency
from genesis_api.identity.models import User, UserCredential, UserRole
from genesis_api.identity.passwords import hash_password, verify_password
from genesis_api.identity.tokens import create_access_token

router = APIRouter(prefix="/auth", tags=["身份认证"])
HANDLE_PATTERN = r"^[a-z0-9][a-z0-9_-]{2,49}$"


class AccessToken(BaseModel):
    """登录令牌响应，只交给认证客户端使用，不得写入日志。"""

    access_token: str
    token_type: str = "bearer"


class CurrentUser(BaseModel):
    """当前用户的可展示资料与角色，不包含密码哈希或凭据实体。"""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    handle: str
    display_name: str
    bio: str
    avatar_url: str | None
    role: str


class RegistrationRequest(BaseModel):
    """普通成员注册输入，账号规范化后校验，密码仅用于生成哈希。"""

    handle: str = Field(pattern=HANDLE_PATTERN)
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("handle", mode="before")
    @classmethod
    def normalize_handle(cls, value: object) -> object:
        """在账号格式校验前去除首尾空白并转小写，其他类型交给字段校验。"""
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        """规范化注册显示名称，去除首尾空白后为空时抛出 ValueError。"""
        normalized_value = value.strip()
        if not normalized_value:
            raise ValueError("显示名称不能为空")
        return normalized_value


class ProfileUpdateRequest(BaseModel):
    """当前用户可修改的资料字段，不允许通过此契约更改账号或角色。"""

    display_name: str = Field(min_length=1, max_length=100)
    bio: str = Field(default="", max_length=1000)
    avatar_url: str | None = Field(default=None, max_length=500)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        """规范化更新后的显示名称，去除首尾空白后为空时抛出 ValueError。"""
        normalized_value = value.strip()
        if not normalized_value:
            raise ValueError("显示名称不能为空")
        return normalized_value

    @field_validator("bio")
    @classmethod
    def normalize_bio(cls, value: str) -> str:
        """去除简介首尾空白，允许空简介。"""
        return value.strip()

    @field_validator("avatar_url")
    @classmethod
    def normalize_avatar_url(cls, value: str | None) -> str | None:
        """去除头像地址首尾空白，将空字符串视为清除头像，不请求该地址。"""
        if value is None:
            return None
        normalized_value = value.strip()
        return normalized_value or None


@router.post("/register", response_model=CurrentUser, status_code=status.HTTP_201_CREATED)
def register_account(data: RegistrationRequest, session: SessionDependency) -> CurrentUser:
    """创建普通成员并保存密码哈希，不自动签发登录令牌。

    Args:
        data: 已校验的注册信息，不能由客户端指定所有者角色。
        session: 当前请求会话，此处提交用户及凭据。

    Returns:
        新用户的公开资料。

    Raises:
        HTTPException: 数据库唯一性冲突时回滚并返回 409。
    """
    user = User(
        handle=data.handle,
        display_name=data.display_name,
        role=UserRole.MEMBER,
        credential=UserCredential(password_hash=hash_password(data.password)),
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该账号已被使用") from None
    session.refresh(user)
    return CurrentUser.model_validate(user)


@router.post("/login", response_model=AccessToken)
def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: SessionDependency,
) -> AccessToken:
    """验证账号密码并签发令牌，成功时更新最后登录时间。

    Args:
        form_data: OAuth2 表单中的账号与密码，不得输出或记录。
        session: 当前请求会话，提交登录时间更新。

    Returns:
        Bearer 访问令牌，不返回密码哈希。

    Raises:
        HTTPException: 用户不存在、缺少凭据或密码不匹配，统一返回 401。
    """
    user = session.scalar(
        select(User).where(User.handle == form_data.username).options(selectinload(User.credential))
    )
    if user is None or user.credential is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码错误")
    if not verify_password(form_data.password, user.credential.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码错误")

    user.credential.last_login_at = datetime.now(UTC)
    session.commit()
    return AccessToken(access_token=create_access_token(user))


@router.post("/dev-login", response_model=AccessToken)
def development_login(session: SessionDependency) -> AccessToken:
    """仅在开发环境签发示例所有者令牌，不要求输入账号密码。

    Args:
        session: 当前请求会话，用于读取开发示例所有者。

    Returns:
        示例所有者的 Bearer 访问令牌。

    Raises:
        HTTPException: 非开发环境返回 404；示例所有者未就绪返回 503。
    """
    from genesis_api.core.config import get_settings

    settings = get_settings()
    if settings.environment != "development":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="接口不存在")
    user = session.scalar(
        select(User).where(User.handle == "genesis").options(selectinload(User.credential))
    )
    if user is None or user.role is not UserRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="开发 Owner 尚未初始化",
        )
    return AccessToken(access_token=create_access_token(user))


@router.get("/me", response_model=CurrentUser)
def get_me(current_user: CurrentUserDependency) -> CurrentUser:
    """返回身份依赖已经认证的当前用户资料，不暴露凭据。"""
    return CurrentUser.model_validate(current_user)


@router.put("/me", response_model=CurrentUser)
def update_me(
    data: ProfileUpdateRequest, current_user: CurrentUserDependency, session: SessionDependency
) -> CurrentUser:
    """更新当前用户自身的可编辑资料并提交，不修改账号或角色。

    Args:
        data: 已校验的显示名称、简介与头像地址。
        current_user: 身份依赖认证的用户，不能通过请求替换目标用户。
        session: 当前请求会话，此处提交并刷新用户实体。

    Returns:
        更新后的公开用户资料。
    """
    current_user.display_name = data.display_name
    current_user.bio = data.bio
    current_user.avatar_url = data.avatar_url
    session.commit()
    session.refresh(current_user)
    return CurrentUser.model_validate(current_user)
