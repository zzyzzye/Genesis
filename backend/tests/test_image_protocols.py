"""依据公开协议验证模型差异，不发送真实生成请求。"""

from uuid import uuid4

import pytest
from fastapi import HTTPException

from genesis_api.media import gemini_image, image_protocols, xai_image
from genesis_api.media.schemas import CanvasNode, GenerationSettings


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://zl.yyapi.cloud", True),
        ("https://www.yyapi.cloud/v1", True),
        ("https://yyapi.cloud", True),
        ("https://api.x.ai", False),
        ("https://yyapi.cloud.example.org", False),
        ("https://example.org/yyapi.cloud", False),
    ],
)
def test_xai_gateway_transport_is_scoped_to_hostname(url: str, expected: bool) -> None:
    """仅已确认的网关域名使用文件表单，不影响直连及其他服务商。"""
    assert xai_image.uses_multipart_edits(url) is expected


def node(model: str, **settings: object) -> CanvasNode:
    """构造包含合成提示词的最小节点。"""
    return CanvasNode(
        id=uuid4(),
        type="image_generation",
        x=0,
        y=0,
        width=600,
        height=400,
        text="窗边的橘猫",
        generation=GenerationSettings.model_validate({"model": model, **settings}),
    )


@pytest.mark.parametrize(
    "model",
    [
        "[原生] gpt-image-2",
        "[原生] gpt-image-2-pro",
        "[官key] gpt-image-2",
        "[超分] gpt-image-2",
        "[专线] gpt-image-2-pro",
        "[max质量] gpt-image-2.5-sunburst",
        "[超分] gpt-image-2.5-flare",
        "[原生] gpt-image-2.6-flare",
        "[原生] gpt-image-2.6-sunburst",
    ],
)
def test_gpt_aliases_keep_exact_routing_name(model: str) -> None:
    prepared = image_protocols.prepare_node(node(model))
    assert prepared.generation.model == model
    assert not gemini_image.uses_generate_content(model)
    assert not xai_image.uses_json_edits(model)


@pytest.mark.parametrize(
    "ratio",
    [
        "1:1",
        "1:2",
        "2:1",
        "9:16",
        "16:9",
        "3:4",
        "4:3",
        "3:2",
        "2:3",
        "5:4",
        "4:5",
        "21:9",
        "9:21",
    ],
)
@pytest.mark.parametrize("resolution", ["1K", "2K", "4K"])
def test_all_canvas_gpt_presets_produce_valid_sizes(ratio: str, resolution: str) -> None:
    original = node("gpt-image-2", image_ratio=ratio, image_resolution=resolution)
    prepared = image_protocols.prepare_node(original)
    width, height = map(int, prepared.generation.image_size.split("x"))
    x, y = map(int, ratio.split(":"))
    assert image_protocols.valid_gpt_size(width, height)
    assert abs(width / height / (x / y) - 1) <= 0.01
    assert original.generation.image_size == ""
    assert image_protocols.prepare_node(prepared) == prepared


@pytest.mark.parametrize(
    ("ratio", "resolution", "size"),
    [
        ("16:9", "4K", "3840x2160"),
        ("9:16", "4K", "2160x3840"),
        ("1:1", "4K", "2880x2880"),
        ("16:9", "1K", "1088x608"),
        ("1:1", "1K", "1024x1024"),
        ("3:4", "2K", "1536x2048"),
    ],
)
def test_gpt_preset_mapping(ratio: str, resolution: str, size: str) -> None:
    prepared = image_protocols.prepare_node(
        node(
            "gpt-image-2",
            image_ratio=ratio,
            image_resolution=resolution,
            image_size="4096x4096",
        )
    )
    assert prepared.generation.image_size == size


@pytest.mark.parametrize("size", ["4096x4096", "1000x1000", "1024x576", "3840x3840", "3840x512"])
def test_explicit_invalid_gpt_size_is_not_silently_changed(size: str) -> None:
    with pytest.raises(HTTPException, match="16 像素"):
        image_protocols.prepare_node(node("gpt-image-2", image_size=size))


@pytest.mark.parametrize(
    "model",
    [
        "gemini-nano-banana-2.1-as",
        "[AS专线] nano-banana-2.1",
        "gemini-3.1-flash-image",
        "[专线] gemini-3.1-flash-image",
        "[AS专线] gemini-3-pro-image-preview",
    ],
)
def test_gemini_aliases_convert_rounded_legacy_sizes(model: str) -> None:
    original = node(model, image_size="1024x680")
    prepared = image_protocols.prepare_node(original)
    endpoint, payload = gemini_image.request_data(prepared, "https://synthetic.example")
    assert endpoint.endswith(":generateContent")
    assert prepared.generation.model == model
    assert payload["generationConfig"]["imageConfig"] == {"aspectRatio": "3:2", "imageSize": "1K"}


def test_legacy_gemini_omits_unsupported_image_size_field() -> None:
    prepared = image_protocols.prepare_node(
        node(
            "gemini-2.5-flash-image",
            image_resolution="1K",
            image_ratio="16:9",
        )
    )
    _, payload = gemini_image.request_data(prepared, "https://synthetic.example")
    assert payload["generationConfig"]["imageConfig"] == {"aspectRatio": "16:9"}


@pytest.mark.parametrize(
    ("model", "settings"),
    [
        ("gemini-3.1-flash-image", {"count": 4}),
        ("gemini-nano-banana-2.1", {"image_ratio": "9:21"}),
        ("gemini-3-pro-image-preview", {"image_ratio": "1:2"}),
        ("gemini-3-pro-image-preview", {"image_size": "1270x1000"}),
        ("gemini-2.5-flash-image", {"image_resolution": "2K"}),
        ("grok-imagine-image-2.0", {"image_resolution": "4K"}),
    ],
)
def test_family_specific_invalid_parameters(model: str, settings: dict[str, object]) -> None:
    with pytest.raises(HTTPException) as exc:
        image_protocols.prepare_node(node(model, **settings))
    assert exc.value.status_code == 422


@pytest.mark.parametrize(
    "model",
    [
        "seedream-5-lite",
        "seedream-5-pro",
        "gemini-3.1-pro",
        "unknown-image-model",
        "gpt-image-99",
        "imagen-4.0-generate-001",
        "grok-imagine-image-99",
    ],
)
def test_unknown_protocol_never_defaults_to_gpt_images(model: str) -> None:
    with pytest.raises(HTTPException, match="尚未确认图片提交协议"):
        image_protocols.prepare_node(node(model))
