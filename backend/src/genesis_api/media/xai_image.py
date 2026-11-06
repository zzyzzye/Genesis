"""转换 Grok Imagine 图片协议，复用现有任务、传输与账务流程。"""

import re
from typing import Any

from fastapi import HTTPException

from genesis_api.media.schemas import CanvasNode

ASPECT_RATIOS = (
    "1:1",
    "16:9",
    "9:16",
    "4:3",
    "3:4",
    "3:2",
    "2:3",
    "2:1",
    "1:2",
    "19.5:9",
    "9:19.5",
    "20:9",
    "9:20",
    "21:9",
    "5:2",
)


def uses_json_edits(model: str) -> bool:
    """只识别 Grok Imagine 图片系列，渠道前缀仍完整传给供应商。"""
    name = model.rsplit("]", 1)[-1].strip().lower()
    return bool(re.fullmatch(r"grok-imagine-image-2\.0", name))


def request_data(node: CanvasNode) -> dict[str, Any]:
    """转换图片参数，不静默降级不受支持的尺寸或背景。

    Args:
        node: 已保存的生图节点；参考图片由调用方按授权顺序追加。

    Returns:
        用于生成或编辑的 JSON 请求体。

    Raises:
        HTTPException: 用户选择了当前 Grok 图片接口不支持的参数。
    """
    settings = node.generation
    ratio: str = settings.image_ratio
    resolution: str = settings.image_resolution
    if settings.image_background == "transparent":
        raise HTTPException(422, "Grok 生图不支持透明背景，请选择自动或保留背景")
    if settings.image_size and settings.image_size != "auto":
        width, height = (int(value) for value in settings.image_size.split("x"))
        if not ratio:
            # 旧画布尺寸可能按 8 像素取整，仅容忍取整误差，不改变画面比例。
            ratios = {
                value: float(value.split(":")[0]) / float(value.split(":")[1])
                for value in ASPECT_RATIOS
            }
            ratio = min(ratios, key=lambda value: abs(ratios[value] - width / height))
            if abs(ratios[ratio] / (width / height) - 1) > 0.01:
                raise HTTPException(422, "Grok 生图不支持该尺寸比例，请重新选择比例")
        resolution = resolution or (
            "1K" if max(width, height) <= 1024 else "2K" if max(width, height) <= 2048 else "4K"
        )
    if ratio and ratio not in ASPECT_RATIOS:
        raise HTTPException(422, "Grok 生图不支持该比例，请选择 1:1、16:9 或其他支持的比例")
    if resolution and resolution not in ("1K", "2K"):
        raise HTTPException(422, "Grok 生图仅支持 1K、2K 分辨率，请调整后再生成")
    return {
        "model": settings.model,
        "prompt": node.text.strip(),
        "n": settings.count,
        "response_format": "b64_json",
        **({"aspect_ratio": ratio} if ratio else {}),
        **({"resolution": resolution.lower()} if resolution else {}),
    }
