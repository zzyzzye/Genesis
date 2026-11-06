"""在计费前校验已确认的图片协议，未知型号不猜测接口。"""

import re

from fastapi import HTTPException

from genesis_api.media import gemini_image, xai_image
from genesis_api.media.schemas import CanvasNode


def gpt_image(model: str) -> bool:
    """保留供应商公开前缀，仅用基础型号选择已核对的 GPT Image 2 协议。"""
    name = model.rsplit("]", 1)[-1].strip().lower()
    return bool(re.fullmatch(r"gpt-image-2(?:-pro|\.[56]-(?:sunburst|flare))?", name))


def valid_gpt_size(width: int, height: int) -> bool:
    """检查 GPT Image 2 系列的像素对齐、边长、比例和总像素范围。"""
    return (
        width > 0
        and height > 0
        and width % 16 == height % 16 == 0
        and max(width, height) <= 3840
        and max(width, height) <= 3 * min(width, height)
        and 655_360 <= width * height <= 8_294_400
    )


def prepare_node(node: CanvasNode) -> CanvasNode:
    """校验系列参数，将画布的比例/清晰度意图转换为合法尺寸快照。

    Args:
        node: 画布中的原始生图节点，不原地修改用户草稿。

    Returns:
        用于报价、持久任务及实际请求的同一份节点快照。

    Raises:
        HTTPException: 未确认协议，或显式像素尺寸不受支持。
    """
    settings = node.generation
    if gemini_image.uses_generate_content(settings.model):
        gemini_image.request_data(node, "")
        return node
    if xai_image.uses_json_edits(settings.model):
        xai_image.request_data(node)
        return node
    if not gpt_image(settings.model):
        raise HTTPException(
            422,
            "该模型尚未确认图片提交协议，已停止提交；"
            "请选择 GPT Image 2、Gemini 图片或 Grok 图片模型",
        )
    size = settings.image_size
    if settings.image_ratio or settings.image_resolution:
        # 画布的 1K/2K/4K 是尺寸意图，不能直接把 Gemini 的 4096 边长发给 GPT。
        ratio = settings.image_ratio or "1:1"
        x, y = (int(value) for value in ratio.split(":"))
        edge = {"1K": 1024, "2K": 2048, "4K": 4096}[settings.image_resolution or "1K"]
        candidates = []
        for width in range(16, 3841, 16):
            height = round(width * y / x / 16) * 16
            if valid_gpt_size(width, height) and abs(width / height / (x / y) - 1) <= 0.01:
                candidates.append((width, height))
        if not candidates:
            raise HTTPException(422, "GPT Image 不支持该比例，请重新选择图片比例")
        width, height = min(candidates, key=lambda pair: abs(max(pair) - edge))
        size = f"{width}x{height}"
    if size and size != "auto":
        width, height = (int(value) for value in size.split("x"))
        if not valid_gpt_size(width, height):
            raise HTTPException(
                422,
                "GPT Image 尺寸须为 16 像素倍数，最长边不超过 3840，比例不超过 3:1，"
                "总像素为 655360–8294400；请选择比例与清晰度，或使用模型默认尺寸",
            )
    return node.model_copy(update={"generation": settings.model_copy(update={"image_size": size})})


def reference_limit(model: str) -> int:
    """返回当前适配的引用上限；未知系列必须先通过 prepare_node。"""
    if gemini_image.uses_generate_content(model):
        return 3 if "2.5-flash-image" in model else 14
    if xai_image.uses_json_edits(model):
        return 5
    return 16
