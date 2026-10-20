"""验证来源识别、上游降级与头像转发边界，不访问真实 IP 或 QQ。"""

from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError

from genesis_api.blog import comment_metadata
from genesis_api.blog.comments import CommentDeviceHints, CommentWrite


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
    assert comment_metadata.device_labels(chrome) == ("Chrome 131", "Windows（版本未知）")
    assert comment_metadata.device_labels(chrome + " Edg/131.0.0.0") == (
        "Edge 131",
        "Windows（版本未知）",
    )
    assert comment_metadata.device_labels("") == (None, None)
    assert comment_metadata.device_labels("invalid-test") == (None, None)


@pytest.mark.parametrize(
    ("platform_version", "expected"),
    [
        ("1.0.0", "10"),
        ("10.0.0", "10"),
        ("13.0.0", "11"),
        ("19.0.0", "11"),
        ("0.0.0", None),
        ("11.0.0", None),
        ("12.0.0", None),
        (None, None),
    ],
)
def test_windows_client_hints(platform_version: str | None, expected: str | None) -> None:
    """普通 UA 不区分 10/11；只使用已定义的平台版本范围。"""
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0.0.0 Safari/537.36"
    hints = CommentDeviceHints(
        platform="Windows",
        platform_version=platform_version,
        full_version_list=[{"brand": "Google Chrome", "version": "132.0.6834.110"}],
    )
    assert comment_metadata.device_labels(ua, hints) == (
        "Chrome 132.0.6834.110",
        f"Windows {expected}" if expected else "Windows（版本未知）",
    )


@pytest.mark.parametrize(
    ("platform", "ua", "version", "browser", "system"),
    [
        ("Windows", "Windows NT 6.1; Win64; x64", "13.0.0", "Chrome 132", "Windows 7"),
        ("Windows", "Windows NT 6.0", None, "Chrome 132", "Windows Vista"),
        ("Windows", "Windows NT 5.1", None, "Chrome 132", "Windows XP"),
        ("Windows", "Windows NT 6.3; Win64; x64", None, "Chrome 132", "Windows 8.1"),
        ("macOS", "Macintosh; Intel Mac OS X 10_15_7", "15.3.1", "Chrome 132", "macOS 15.3.1"),
        ("macOS", "Macintosh; Intel Mac OS X 10_15_7", None, "Chrome 132", "macOS"),
        ("Android", "Linux; Android 10; K", "15.0.0", "Chrome Mobile 132", "Android 15.0.0"),
        ("Android", "Linux; Android 10; K", None, "Chrome Mobile 132", "Android"),
        ("Android", "Linux; Android 10; K", "0.0.0", "Chrome Mobile 132", "Android"),
        ("Android", "Windows NT 10.0; Win64; x64", "15.0.0", "Chrome 132", "Windows（版本未知）"),
    ],
)
def test_system_versions(
    platform: str, ua: str, version: str | None, browser: str, system: str
) -> None:
    """保留真实版本，忽略跨平台提示和 Chromium 冻结的系统版本。"""
    mobile = " Mobile" if platform == "Android" and ua.startswith("Linux") else ""
    agent = f"Mozilla/5.0 ({ua}) AppleWebKit/537.36 Chrome/132.0.0.0{mobile} Safari/537.36"
    assert comment_metadata.device_labels(
        agent, CommentDeviceHints(platform=platform, platform_version=version)
    ) == (browser, system)


def test_safari_and_firefox_versions() -> None:
    """不支持 Client Hints 的浏览器仍从 UA 读取可确认的版本。"""
    safari = (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) "
        "AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1"
    )
    assert comment_metadata.device_labels(safari) == ("Mobile Safari 18.1", "iOS 18.1.1")
    firefox = "Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.12"
    hints = CommentDeviceHints(full_version_list=[{"brand": "Chromium", "version": "132.1"}])
    assert comment_metadata.device_labels(firefox, hints) == ("Firefox 115.12", "Windows 7")


def test_edge_brand_priority() -> None:
    """优先浏览器品牌，不把 Chromium 内核或 GREASE 当作 Edge 版本。"""
    agent = "Mozilla/5.0 (Windows NT 10.0) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0"
    hints = CommentDeviceHints(
        full_version_list=[
            {"brand": "Chromium", "version": "132.0.1.2"},
            {"brand": "Not A Brand", "version": "99.0.0.0"},
            {"brand": "Microsoft Edge", "version": "132.0.2957.127"},
        ]
    )
    assert comment_metadata.device_labels(agent, hints)[0] == "Edge 132.0.2957.127"


def test_chromium_hint_never_renames_chrome() -> None:
    """只有内核品牌时保留 UA 浏览器，不把内核完整版本移给 Chrome。"""
    agent = "Mozilla/5.0 (Windows NT 10.0) Chrome/132.0.0.0 Safari/537.36"
    hints = CommentDeviceHints(
        full_version_list=[{"brand": "Chromium", "version": "132.0.6834.110"}]
    )
    assert comment_metadata.device_labels(agent, hints)[0] == "Chrome 132"


@pytest.mark.parametrize("frozen_version", ["18_6", "18_6_2", "18_7"])
def test_safari_frozen_ios(frozen_version: str) -> None:
    """Safari 26 的旧系统占位不能冒充实际 iOS 版本。"""
    agent = (
        f"Mozilla/5.0 (iPhone; CPU iPhone OS {frozen_version} like Mac OS X) "
        "AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1"
    )
    assert comment_metadata.device_labels(agent) == ("Mobile Safari 26.0", "iOS")


@pytest.mark.parametrize(
    "payload",
    [
        {"platform_version": "not-version"},
        {"platform_version": "1." + "1" * 33},
        {"full_version_list": [{"brand": "Chrome", "version": "1;script"}]},
        {"full_version_list": [{"brand": "Chrome", "version": "1"}] * 9},
        {"model": "不收集设备型号"},
    ],
)
def test_device_hints_validation(payload: dict[str, object]) -> None:
    """版本输入有长度、格式与字段边界，不接受额外设备资料。"""
    with pytest.raises(ValidationError):
        CommentDeviceHints.model_validate(payload)


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
