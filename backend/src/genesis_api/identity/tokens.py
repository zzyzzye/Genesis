from datetime import UTC, datetime, timedelta
from uuid import UUID

from jwt import InvalidTokenError, decode, encode

from genesis_api.core.config import get_settings
from genesis_api.identity.models import User


def create_access_token(user: User) -> str:
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
