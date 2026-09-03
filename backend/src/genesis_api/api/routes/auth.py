from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from genesis_api.api.dependencies import CurrentUserDependency, SessionDependency
from genesis_api.identity.models import User
from genesis_api.identity.passwords import verify_password
from genesis_api.identity.tokens import create_access_token

router = APIRouter(prefix="/auth", tags=["身份认证"])


class AccessToken(BaseModel):
    access_token: str
    token_type: str = "bearer"


class CurrentUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    handle: str
    display_name: str
    role: str


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
