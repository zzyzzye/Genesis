from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from genesis_api.database.session import get_session
from genesis_api.identity.models import User, UserRole
from genesis_api.identity.tokens import get_user_id_from_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
SessionDependency = Annotated[Session, Depends(get_session)]
TokenDependency = Annotated[str, Depends(oauth2_scheme)]


def credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="登录状态无效或已过期",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(token: TokenDependency, session: SessionDependency) -> User:
    user_id = get_user_id_from_token(token)
    if user_id is None:
        raise credentials_exception()

    user = session.get(User, user_id)
    if user is None:
        raise credentials_exception()
    return user


def require_owner(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    if current_user.role is not UserRole.OWNER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要站点管理权限")
    return current_user


CurrentUserDependency = Annotated[User, Depends(get_current_user)]
OwnerDependency = Annotated[User, Depends(require_owner)]
