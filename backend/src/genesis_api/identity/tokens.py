"""签发与校验用户访问令牌；角色授权仍以数据库当前值为准。"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from jwt import InvalidTokenError, decode, encode

from genesis_api.core.config import get_settings
from genesis_api.identity.models import User


def create_access_token(user: User) -> str:
    """为已认证用户签发有时限的 HS256 访问令牌。

    Args:
        user: 已完成认证的用户实体，此处不检查账号密码。

    Returns:
        包含用户 UUID、角色及有效期的 JWT，只供认证响应使用，不得记录。
    """
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user.id),
        "role": user.role.value,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_access_token_expire_minutes),
    }
    return encode(
        payload,
        settings.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )


def get_user_id_from_token(token: str) -> UUID | None:
    """校验访问令牌的签名、有效期与用户标识，不查询数据库。

    Args:
        token: 客户端提交的 Bearer 令牌，不得输出或记录。

    Returns:
        有效令牌中的用户 UUID；令牌无效、过期或 sub 格式错误时返回 None。
        用户是否仍存在及当前角色由 API 依赖进一步检查。
    """
    settings = get_settings()
    try:
        payload = decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
        )
        subject = payload.get("sub")
        return UUID(subject) if isinstance(subject, str) else None
    except (InvalidTokenError, ValueError):
        return None
