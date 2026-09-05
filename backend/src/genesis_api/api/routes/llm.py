from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from genesis_api.api.dependencies import OwnerDependency
from genesis_api.core.config import Settings, get_settings
from genesis_api.llm.models import ProviderModels, ProviderName
from genesis_api.llm.service import ModelDiscoveryError, ModelDiscoveryService

router = APIRouter(prefix="/llm", tags=["llm"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]


@router.get("/providers/{provider}/models", response_model=ProviderModels)
async def list_provider_models(
    provider: ProviderName,
    _: OwnerDependency,
    settings: SettingsDependency,
) -> ProviderModels:
    try:
        return await ModelDiscoveryService(settings).list_models(provider)
    except ModelDiscoveryError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
