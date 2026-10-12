"""验证来源识别、上游降级与头像转发边界，不访问真实 IP 或 QQ。"""

from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError

from genesis_api.blog import comment_metadata
from genesis_api.blog.comments import CommentWrite


@pytest.mark.parametrize("value", ["12345", " 12345@QQ.COM "])
def test_qq_normalization(value: str) -> None:
    """数字 QQ 邮箱和 QQ 号规范化成相同身份资料。"""
    assert CommentWrite(content="测试", submission_id=uuid4(), qq=value).qq == "12345"


@pytest.mark.parametrize("value", ["alias@qq.com", "1234", "012345", "12345@example.com", "1" * 12])
def test_qq_rejects_alias(value: str) -> None:
    """不接受邮箱别名或可拼接到上游地址的任意字符串。"""
    with pytest.raises(ValidationError):
        CommentWrite(content="测试", submission_id=uuid4(), qq=value)
    assert CommentWrite(content="测试", submission_id=uuid4(), qq=" ").qq is None


def test_device_labels() -> None:
    """识别常用设备，对缺失和未知 UA 不虚构设备。"""
    chrome = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )
    assert comment_metadata.device_labels(chrome) == ("Chrome", "Windows")
    assert comment_metadata.device_labels(chrome + " Edg/131.0.0.0") == ("Edge", "Windows")
    assert comment_metadata.device_labels("") == (None, None)
    assert comment_metadata.device_labels("invalid-test") == (None, None)


def mock_upstream(monkeypatch: pytest.MonkeyPatch, response: httpx.Response) -> None:
    """用本地 HTTP 替身验证所有上游分支。"""
    original = httpx.Client
    monkeypatch.setattr(
        "genesis_api.blog.comment_metadata.httpx.Client",
        lambda **kwargs: original(
            transport=httpx.MockTransport(lambda request: response), **kwargs
        ),
    )


@pytest.mark.parametrize("host", [None, "invalid", "127.0.0.1", "192.168.0.1", "::1"])
def test_private_ip_never_queries(host: str | None, monkeypatch: pytest.MonkeyPatch) -> None:
    """内网地址不调用外部服务。"""

    def unexpected(**kwargs: object) -> None:
        pytest.fail("内网地址不应请求上游")

    monkeypatch.setattr("genesis_api.blog.comment_metadata.httpx.Client", unexpected)
    assert comment_metadata.lookup_region(host) is None


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"success": True, "country_code": "CN", "region": "浙江省"}, "浙江省"),
        ({"success": True, "country_code": "US", "country": "美国"}, "美国"),
        ({"success": False}, None),
        ({"success": True, "region": 123}, None),
        ([], None),
    ],
)
def test_region_projection(
    payload: object, expected: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """只投影省份或国家，上游不完整时仍可提交评论。"""
    mock_upstream(monkeypatch, httpx.Response(200, json=payload))
    assert comment_metadata.lookup_region("8.8.8.8") == expected


@pytest.mark.parametrize("response", [httpx.Response(500), httpx.Response(200, text="invalid")])
def test_region_upstream_failure(response: httpx.Response, monkeypatch: pytest.MonkeyPatch) -> None:
    """网络与协议失败不传出原始地址或异常。"""
    mock_upstream(monkeypatch, response)
    assert comment_metadata.lookup_region("8.8.8.8") is None


@pytest.mark.parametrize(
    ("status", "mime", "content", "expected"),
    [
        (200, "image/png", b"test-image", (b"test-image", "image/png")),
        (200, "text/html", b"invalid", None),
        (200, "image/png", b"", None),
        (200, "image/png", b"x" * (1024 * 1024 + 1), None),
        (500, "image/png", b"invalid", None),
    ],
)
def test_avatar_limits(
    status: int,
    mime: str,
    content: bytes,
    expected: tuple[bytes, str] | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """拒绝非图片、空响应、过大响应和错误状态。"""
    mock_upstream(
        monkeypatch, httpx.Response(status, headers={"content-type": mime}, content=content)
    )
    assert comment_metadata.qq_avatar("12345") == expected
