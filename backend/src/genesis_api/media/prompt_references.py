"""将绑定真实画布节点的图片引用解析为本次请求中的图片序号。"""

import re
from uuid import UUID

from fastapi import HTTPException

MENTION = re.compile(r"@\[图片\]\(ref:([a-zA-Z0-9_-]+)\)")


def resolve_image_mentions(text: str, image_numbers: dict[UUID, int]) -> str:
    """按实际发送顺序解析引用，断线或未就绪的引用禁止降级为普通文字。

    Args:
        text: 用户保存的原始提示词，普通文字保持原样。
        image_numbers: 已完成归属及文件校验的来源节点与本次图片序号。

    Returns:
        供上游读取的提示词，不包含画布内部节点标识。

    Raises:
        HTTPException: 引用不是已连接且可用的图片时返回 422。
    """
    if not MENTION.search(text):
        return text

    def replace(match: re.Match[str]) -> str:
        try:
            number = image_numbers[UUID(match[1])]
        except (ValueError, KeyError):
            raise HTTPException(
                422,
                "提示词中的图片引用已断开或尚未就绪，请重新连接图片或删除该引用",
            ) from None
        return f"图片{number}"

    return "参考图片按实际上传顺序编号，图片1对应第一张，依次类推。\n" + MENTION.sub(replace, text)
