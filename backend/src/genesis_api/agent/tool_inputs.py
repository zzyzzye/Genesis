"""工具输入的有限兼容与安全校验回执，继续由 Pydantic 校验完整契约。"""

from __future__ import annotations

import json
import re
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, ValidationError
from pydantic.v1 import ValidationError as ValidationErrorV1


def decode_json_array(value: object) -> object:
    """仅解码模型误传的 JSON 数组字符串，不转换普通文本或其他 JSON 类型。"""
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except ValueError:
            return value
        if isinstance(decoded, list):
            return decoded
    return value


type ToolArray[T] = Annotated[list[T], BeforeValidator(decode_json_array)]
type InputReason = Literal[
    "缺少必填字段", "必须是数组", "必须是对象", "必须是字符串", "未声明的参数，请移除",
    "内容过长", "内容过短或为空", "数量超出范围", "数量不足", "内容不符合工具定义",
]

_REASONS: dict[str, InputReason] = {
    "missing": "缺少必填字段", "list_type": "必须是数组", "dict_type": "必须是对象",
    "model_type": "必须是对象", "model_attributes_type": "必须是对象",
    "string_type": "必须是字符串", "extra_forbidden": "未声明的参数，请移除",
    "string_too_long": "内容过长", "string_too_short": "内容过短或为空",
    "too_long": "数量超出范围", "too_short": "数量不足",
}


class ToolInputIssue(BaseModel):
    """只保留字段位置和固定原因，不携带输入值、异常原文或正文。"""

    model_config = ConfigDict(extra="forbid")

    path: str = Field(pattern=r"^[A-Za-z_][A-Za-z_0-9.\[\]]{0,159}$")
    reason: InputReason


class ToolInputFailure(BaseModel):
    """供模型修正参数、供历史展示安全原因的同一份回执。"""

    model_config = ConfigDict(extra="forbid")

    type: Literal["tool_input_error"] = "tool_input_error"
    fields: list[ToolInputIssue] = Field(min_length=1, max_length=8)
    hint: Literal["请按工具定义修正这些字段后重试；数组直接传数组，选项必须是对象。"] = (
        "请按工具定义修正这些字段后重试；数组直接传数组，选项必须是对象。"
    )


def tool_validation_error(error: ValidationError | ValidationErrorV1) -> str:
    """将原生校验错误转换成可修正的工具回执，不复制任何输入值。"""
    errors = (
        error.errors(include_input=False, include_url=False)
        if isinstance(error, ValidationError) else error.errors()
    )
    fields = []
    for item in errors[:8]:
        path = ""
        for part in item["loc"]:
            if isinstance(part, int):
                path = (path or "arguments") + f"[{part}]"
            elif isinstance(part, str) and re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]{0,63}", part):
                path += ("." if path else "") + part
        fields.append(ToolInputIssue(
            path=(path or "arguments")[:160],
            reason=_REASONS.get(item["type"], "内容不符合工具定义"),
        ))
    return ToolInputFailure(fields=fields).model_dump_json()


def tool_input_error_summary(data: object) -> str | None:
    """仅展示通过固定安全契约的字段错误，不接受普通工具异常文本。"""
    if not isinstance(data, dict) or data.get("type") != "tool_input_error":
        return None
    try:
        failure = ToolInputFailure.model_validate(data)
    except ValidationError:
        return None
    details = "；".join(f"{item.path}：{item.reason}" for item in failure.fields[:3])
    suffix = f"（共 {len(failure.fields)} 项）" if len(failure.fields) > 3 else ""
    return "参数校验失败：" + details + suffix
