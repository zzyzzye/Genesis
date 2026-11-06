"""为 Gemini 原生生图补充协议转换，传输、计费和任务恢复仍由 image 模块负责。"""

import re
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException

from genesis_api.media.schemas import CanvasNode

ASPECT_RATIOS = (
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9",
)


def uses_generate_content(model: str) -> bool:
    """识别 Nano Banana 与 Gemini Image 系列，公开渠道前缀保留给上游路由。"""
    name = model.rsplit("]", 1)[-1].strip().lower()
    return bool(
        re.fullmatch(
            r"(?:gemini-)?nano-banana-2\.1(?:-as)?|gemini-(?:2\.5-flash|3\.1-flash|3-pro)-image(?:-preview)?",
            name,
        )
    )


def request_data(node: CanvasNode, base_url: str) -> tuple[str, dict[str, Any]]:
    """构造单次原生请求，参考图片由调用方按已授权顺序追加到 parts。

    Args:
        node: 已完成参考标签替换的服务端任务快照。
        base_url: 与既有图片渠道相同的服务地址，不包含凭据。

    Returns:
        保留完整公开模型名的请求地址，以及可追加参考图片的请求体。
    """
    settings = node.generation
    if settings.count != 1:
        raise HTTPException(422, "Gemini 图片接口每次只支持 1 张，请将生成数量改为 1")
    if settings.image_background == "transparent":
        raise HTTPException(422, "该图片接口不支持透明背景参数，请选择自动或保留背景")
    config: dict[str, Any] = {
        "responseModalities": ["TEXT", "IMAGE"],
        "candidateCount": 1,
    }
    ratio: str = settings.image_ratio
    resolution: str = settings.image_resolution
    if settings.image_size and settings.image_size != "auto":
        width, height = (int(value) for value in settings.image_size.split("x"))
        if not ratio:
            ratios = {
                value: float(value.split(":")[0]) / float(value.split(":")[1])
                for value in ASPECT_RATIOS
            }
            ratio = min(ratios, key=lambda value: abs(ratios[value] - width / height))
            if abs(ratios[ratio] / (width / height) - 1) > 0.01:
                raise HTTPException(422, "Gemini 图片接口不支持该尺寸比例，请重新选择比例")
        resolution = resolution or (
            "1K" if max(width, height) <= 1024 else "2K" if max(width, height) <= 2048 else "4K"
        )
    if ratio and ratio not in ASPECT_RATIOS:
        raise HTTPException(422, "Gemini 图片接口不支持该比例，请重新选择图片比例")
    if "2.5-flash-image" in settings.model:
        if resolution not in ("", "1K"):
            raise HTTPException(422, "Gemini 2.5 Flash Image 不支持 2K/4K，请选择默认或 1K")
        resolution = ""
    image_config = {
        key: value for key, value in (("aspectRatio", ratio), ("imageSize", resolution)) if value
    }
    if image_config:
        config["imageConfig"] = image_config
    # 渠道别名可含中文、空格等字符；不能去掉前缀或让别名改变 URL 路径。
    endpoint = (
        f"{base_url.rstrip('/')}/v1beta/models/{quote(settings.model, safe='')}:generateContent"
    )
    return endpoint, {
        "contents": [{"role": "user", "parts": [{"text": node.text.strip()}]}],
        "generationConfig": config,
    }


def result_images(data: Any) -> list[dict[str, str]]:
    """将原生响应的最终图片转换为既有缓存格式，排除文字和思考阶段图片。"""
    candidates = data.get("candidates") if isinstance(data, dict) else None
    if not isinstance(candidates, list):
        raise ValueError("原生图片结果格式无效")
    rows = []
    for candidate in candidates:
        content = candidate.get("content") if isinstance(candidate, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict) or part.get("thought"):
                continue
            inline = part.get("inlineData")
            if (
                isinstance(inline, dict)
                and isinstance(inline.get("mimeType"), str)
                and inline["mimeType"].startswith("image/")
                and isinstance(inline.get("data"), str)
                and inline["data"]
            ):
                rows.append({"b64_json": inline["data"]})
    return rows
