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
    access_token: str
    token_type: str = "bearer"


class CurrentUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    handle: str
    display_name: str
    bio: str
    avatar_url: str | None
    role: str


class RegistrationRequest(BaseModel):
    handle: str = Field(pattern=HANDLE_PATTERN)
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("handle", mode="before")
    @classmethod
    def normalize_handle(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized_value = value.strip()
        if not normalized_value:
            raise ValueError("显示名称不能为空")
        return normalized_value


class ProfileUpdateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=100)
    bio: str = Field(default="", max_length=1000)
    avatar_url: str | None = Field(default=None, max_length=500)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized_value = value.strip()
        if not normalized_value:
            raise ValueError("显示名称不能为空")
        return normalized_value

    @field_validator("bio")
    @classmethod
    def normalize_bio(cls, value: str) -> str:
        return value.strip()

    @field_validator("avatar_url")
    @classmethod
    def normalize_avatar_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized_value = value.strip()
        return normalized_value or None


@router.post("/register", response_model=CurrentUser, status_code=status.HTTP_201_CREATED)
def register_account(data: RegistrationRequest, session: SessionDependency) -> CurrentUser:
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


@router.get("/me", response_model=CurrentUser)
def get_me(current_user: CurrentUserDependency) -> CurrentUser:
    return CurrentUser.model_validate(current_user)


@router.put("/me", response_model=CurrentUser)
def update_me(
    data: ProfileUpdateRequest, current_user: CurrentUserDependency, session: SessionDependency
) -> CurrentUser:
    current_user.display_name = data.display_name
    current_user.bio = data.bio
    current_user.avatar_url = data.avatar_url
    session.commit()
    session.refresh(current_user)
    return CurrentUser.model_validate(current_user)
