"""所有者可访问的模型目录接口，对外统一转换目录发现错误。"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from genesis_api.api.dependencies import OwnerDependency
from genesis_api.core.config import Settings, get_settings
from genesis_api.llm.models import ProviderModels, ProviderName
from genesis_api.llm.service import ModelDiscoveryError, ModelDiscoveryService

router = APIRouter(prefix="/llm", tags=["llm"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]
logger = logging.getLogger(__name__)


@router.get("/providers/{provider}/models", response_model=ProviderModels)
async def list_provider_models(
    provider: ProviderName,
    _: OwnerDependency,
    settings: SettingsDependency,
) -> ProviderModels:
    """查询供应商模型目录及可选思考档位。

    Args:
        provider: FastAPI 已校验的供应商标识。
        _: 所有者权限依赖，保证接口调用已获授权。
        settings: 应用配置，由依赖注入，不接受客户端凭据。

    Returns:
        可选模型与能力字段，可能包含服务层生成的默认模型回退记录。

    Raises:
        HTTPException: 模型目录发现失败，返回 502。
    """
    try:
        return await ModelDiscoveryService(settings).list_models(provider)
    except ModelDiscoveryError as exc:
        logger.warning("模型列表获取失败：provider=%s，原因=%s", provider, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
