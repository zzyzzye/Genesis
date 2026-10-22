"""工具数组兼容保持原有契约，错误回执只含字段与固定原因。"""

import json
from typing import Any

import pytest
from pydantic import BaseModel, Field, RootModel, ValidationError
from pydantic.v1 import BaseModel as BaseModelV1
from pydantic.v1 import ValidationError as ValidationErrorV1

from genesis_api.agent.questions import QuestionRequest
from genesis_api.agent.tool_inputs import (
    ToolArray,
    decode_json_array,
    tool_input_error_summary,
    tool_validation_error,
)


@pytest.mark.parametrize("value", ["普通文本", "[broken", "{}", "null", '"text"', "12", None])
def test_decoder_only_accepts_json_arrays(value: object) -> None:
    assert decode_json_array(value) == value


def test_encoded_arrays_keep_nested_validation_and_canonical_schema() -> None:
    class Input(BaseModel):
        entries: ToolArray[str] = Field(max_length=2)

    assert Input.model_validate({"entries": '["甲", "乙"]'}).entries == ["甲", "乙"]
    schema = Input.model_json_schema()
    array_ref = schema["properties"]["entries"]["$ref"].rsplit("/", 1)[-1]
    assert schema["$defs"][array_ref]["type"] == "array"
    for value in ('["甲", "乙", "丙"]', "[{}]", "{}"):
        with pytest.raises(ValidationError):
            Input.model_validate({"entries": value})
    options = [
        {"label": "甲", "description": "方向一"},
        {"label": "乙", "description": "方向二"},
    ]
    request = QuestionRequest.model_validate({"questions": json.dumps([{
        "question": "选哪个？", "options": json.dumps(options),
    }])})
    assert request.questions[0].options[1].label == "乙"


def test_validation_receipts_exclude_values_and_unsafe_messages() -> None:
    class Input(BaseModel):
        entries: ToolArray[str]

    with pytest.raises(ValidationError) as caught:
        Input.model_validate({"entries": [{"private-marker": "private-value"}]})
    receipt = tool_validation_error(caught.value)
    assert "private" not in receipt
    assert tool_input_error_summary(json.loads(receipt)) == "参数校验失败：entries[0]：必须是字符串"
    assert tool_input_error_summary({"fields": []}) is None
    assert tool_input_error_summary("private-error") is None
    data: dict[str, Any] = json.loads(receipt)
    data["fields"][0]["reason"] = "private-exception"
    assert tool_input_error_summary(data) is None
    data = json.loads(receipt)
    data["raw_input"] = "private-value"
    assert tool_input_error_summary(data) is None


def test_validation_receipts_bound_length_and_handle_root_and_v1() -> None:
    with pytest.raises(ValidationError) as caught:
        RootModel[list[str]].model_validate([{}] * 10)
    data = json.loads(tool_validation_error(caught.value))
    assert len(data["fields"]) == 8
    assert data["fields"][0]["path"] == "arguments[0]"
    assert "共 8 项" in (tool_input_error_summary(data) or "")

    class OldInput(BaseModelV1):
        entries: list[str]

    with pytest.raises(ValidationErrorV1) as old:
        OldInput.parse_obj({"entries": "private-marker"})
    receipt = tool_validation_error(old.value)
    assert "private" not in receipt
    assert "entries" in receipt
