"""API 共用依赖：数据库会话、登录身份与站点所有者权限。"""

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
    """构造带 Bearer 认证提示的 401 异常，由调用方显式抛出。"""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="登录状态无效或已过期",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(token: TokenDependency, session: SessionDependency) -> User:
    """校验令牌并读取当前用户，权限以数据库中的角色为准。

    Args:
        token: OAuth2 依赖提取的 Bearer 令牌，不得记录。
        session: 当前请求的数据库会话。

    Returns:
        令牌对应的当前用户实体。

    Raises:
        HTTPException: 令牌无效、已过期或用户不存在，返回 401。
    """
    user_id = get_user_id_from_token(token)
    if user_id is None:
        raise credentials_exception()

    user = session.get(User, user_id)
    if user is None:
        raise credentials_exception()
    return user


def require_owner(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """要求已认证用户具有站点所有者角色。

    Args:
        current_user: 身份依赖已校验的数据库用户。

    Returns:
        通过角色检查的所有者实体。

    Raises:
        HTTPException: 已登录但不是所有者，返回 403。
    """
    # 已登录但角色不足返回 403，与令牌失效或用户不存在的 401 区分。
    if current_user.role is not UserRole.OWNER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要站点管理权限")
    return current_user


CurrentUserDependency = Annotated[User, Depends(get_current_user)]
OwnerDependency = Annotated[User, Depends(require_owner)]
