"""应用存活检查，仅返回服务和环境标识，不探测数据库或上游模型。"""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from genesis_api.core.config import get_settings

router = APIRouter()


class HealthResponse(BaseModel):
    """应用健康响应，不代表所有外部依赖都已通过连接检查。"""

    status: Literal["ok"]
    service: str
    environment: str


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """返回应用存活状态及部署环境名称。"""
    settings = get_settings()
    return HealthResponse(
        status="ok",
        service="genesis-api",
        environment=settings.environment,
    )
