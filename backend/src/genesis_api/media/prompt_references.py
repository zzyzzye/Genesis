"""将绑定真实画布节点的图片引用解析为本次请求中的图片序号。"""

import re
from uuid import UUID

from fastapi import HTTPException

from genesis_api.media.schemas import CanvasDocument

MENTION = re.compile(r"@\[图片\]\(ref:([a-zA-Z0-9_-]+)\)")
TEXT_MENTION = re.compile(r"@\[文字\]\(ref:([a-zA-Z0-9_-]+)\)")


def resolve_text_mentions(text: str, document: CanvasDocument, node_id: UUID) -> str:
    """将直接连入的文字引用展开为提交时的内容，不递归展开源文字中的引用。

    Args:
        text: 提示词或已经解析图片序号的提示词。
        document: 当前保存的画布，作为文字内容与连线的唯一来源。
        node_id: 本次生成节点。

    Returns:
        展开后的普通文本；不会修改画布上的引用标记。

    Raises:
        HTTPException: 引用断开、为空、嵌套引用或展开后超过长度限制。
    """
    connected = {edge.source for edge in document.edges if edge.target == node_id}
    sources = {
        str(node.id): node for node in document.nodes
        if node.id in connected and node.id != node_id and node.type == "text"
    }

    def replace(match: re.Match[str]) -> str:
        source = sources.get(match[1])
        if source is None:
            raise HTTPException(422, "提示词中的文字引用已断开，请重新连接文字节点或删除该引用")
        if not source.text.strip():
            raise HTTPException(422, "引用的文字节点内容为空，请填写内容或删除该引用")
        # 禁止通过文字节点间接引用素材或继续递归，避免绕过显式引用规则。
        if MENTION.search(source.text) or TEXT_MENTION.search(source.text):
            raise HTTPException(
                422, "文字节点不能嵌套引用，请使用普通文本并在生成提示词中直接引用素材",
            )
        return source.text

    expanded = TEXT_MENTION.sub(replace, text)
    if TEXT_MENTION.search(text) and len(expanded) > 20000:
        raise HTTPException(422, "展开文字引用后的提示词超过 20000 字符，请缩短文字内容")
    return expanded


def mentioned_image_nodes(text: str) -> set[str]:
    """读取显式引用的图片节点；连线本身仅提供候选素材。"""
    return {match[1] for match in MENTION.finditer(text)}


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
