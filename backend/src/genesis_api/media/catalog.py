"""为生成界面和业务 Agent 提供同一份上游模型简介与单价。"""

import asyncio
from typing import Literal

from genesis_api.billing.pricing import yyapi_pricing_service
from genesis_api.billing.service import is_yyapi
from genesis_api.core.config import Settings
from genesis_api.media import image, video


async def generation_models(
    settings: Settings,
    kind: Literal["image", "video"],
    *,
    refresh: bool = False,
) -> list[dict[str, object]]:
    """合并真实可调用目录、上游简介与当前调用分组的单价。

    Args:
        settings: 当前生成渠道及既有控制台配置，不向输出传播凭据。
        kind: 图片或视频生成。
        refresh: 主动刷新可调用目录和简介。

    Returns:
        每个模型只提供 ID、可用简介与价格预览；不从模型名称推断能力。
    """
    ids = (
        await video.available_models(settings, refresh=refresh)
        if kind == "video"
        else [str(row["id"]) for row in await image.available_models(settings, refresh=refresh)]
    )
    base = settings.video_api_base_url if kind == "video" else settings.image_api_base_url
    descriptions: dict[str, str] = {}
    if is_yyapi(base):
        descriptions, prices = await asyncio.gather(
            yyapi_pricing_service.descriptions(settings, ids, refresh=refresh),
            yyapi_pricing_service.for_models(settings, kind, ids, kind=kind),
        )
    else:
        prices = await yyapi_pricing_service.for_models(settings, kind, ids, kind=kind)
    return [
        {
            "id": name,
            **({"description": descriptions[name]} if name in descriptions else {}),
            "pricing": prices[name].model_dump(exclude={"group", "group_ratio"}),
        }
        for name in ids
    ]
