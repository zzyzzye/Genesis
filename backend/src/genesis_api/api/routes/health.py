from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from genesis_api.core.config import get_settings

router = APIRouter()


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    environment: str


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        status="ok",
        service="genesis-api",
        environment=settings.environment,
    )
