"""登录用户可访问的模型目录接口，对外统一转换目录发现错误。"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from genesis_api.api.dependencies import CurrentUserDependency, SessionDependency
from genesis_api.billing.models import PricePolicy
from genesis_api.billing.pricing import yyapi_pricing_service
from genesis_api.billing.service import channel_id
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
    include_pricing: bool = True,
    refresh: bool = False,
) -> ProviderModels:
    """查询供应商模型目录及可选思考档位。

    Args:
        provider: FastAPI 已校验的供应商标识。
        user: 已登录用户，读取目录不要求站点管理权限。
        settings: 应用配置，由依赖注入，不接受客户端凭据。
        session: 当前请求的数据库会话，批量读取计费资格。
        include_pricing: 是否附带价格；前端先关闭此项读取目录，再独立加载价格。
        refresh: 是否绕过目录缓存有效期，不绕过同渠道请求合并。

    Returns:
        可选模型与能力字段，可能包含服务层生成的默认模型回退记录。

    Raises:
        HTTPException: 模型目录发现失败，返回 502。
    """
    try:
        result = await ModelDiscoveryService(settings).list_models(provider, refresh=refresh)
        prices = await yyapi_pricing_service.for_models(
            settings, provider, [model.id for model in result.models]
        ) if include_pricing else {}
        paid_models: set[str] = set()
        if provider != "mimo" and user.role.value != "owner":
            try:
                channel = channel_id(settings, "agent", provider)
            except HTTPException:
                channel = None
            if channel is not None:
                paid_models = set(session.scalars(select(PricePolicy.model).where(
                    PricePolicy.kind == "agent", PricePolicy.provider == provider,
                    PricePolicy.active.is_(True), PricePolicy.channel == channel,
                )))
        for model in result.models:
            model.pricing = prices.get(model.id)
            model.billing_mode = (
                "free"
                if provider == "mimo"
                else (
                    "platform"
                    if user.role.value == "owner"
                    else "paid"
                    if model.id in paid_models
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
