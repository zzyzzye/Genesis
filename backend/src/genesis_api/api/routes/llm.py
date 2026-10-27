"""登录用户可访问的模型目录接口，对外统一转换目录发现错误。"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from genesis_api.api.dependencies import CurrentUserDependency, SessionDependency
from genesis_api.billing.pricing import yyapi_pricing_service
from genesis_api.billing.service import policy_for
from genesis_api.core.config import Settings, get_settings
from genesis_api.llm.models import ProviderModels, ProviderName
from genesis_api.llm.service import ModelDiscoveryError, ModelDiscoveryService

router = APIRouter(prefix="/llm", tags=["llm"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]
logger = logging.getLogger(__name__)


@router.get("/providers/{provider}/models", response_model=ProviderModels)
async def list_provider_models(
    provider: ProviderName,
    user: CurrentUserDependency,
    settings: SettingsDependency,
    session: SessionDependency,
) -> ProviderModels:
    """查询供应商模型目录及可选思考档位。

    Args:
        provider: FastAPI 已校验的供应商标识。
        user: 已登录用户，读取目录不要求站点管理权限。
        settings: 应用配置，由依赖注入，不接受客户端凭据。

    Returns:
        可选模型与能力字段，可能包含服务层生成的默认模型回退记录。

    Raises:
        HTTPException: 模型目录发现失败，返回 502。
    """
    try:
        result = await ModelDiscoveryService(settings).list_models(provider)
        prices = await yyapi_pricing_service.for_models(
            settings, provider, [model.id for model in result.models]
        )
        for model in result.models:
            model.pricing = prices.get(model.id)
            model.billing_mode = (
                "free"
                if provider == "mimo"
                else (
                    "platform"
                    if user.role.value == "owner"
                    else "paid"
                    if policy_for(session, "agent", provider, model.id, settings)
                    else "unavailable"
                )
            )
        return result
    except ModelDiscoveryError as exc:
        logger.warning("模型列表获取失败：provider=%s，原因=%s", provider, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
