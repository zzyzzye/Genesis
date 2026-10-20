"""评论来源适配：只保留粗粒度地区及可确认的浏览器、系统版本。"""

import re
from ipaddress import ip_address

import httpx
from ua_parser import parse

from genesis_api.blog.comments import CommentDeviceHints


def _version(*parts: str | None) -> str:
    """合并 UA 规则给出的数字版本，遇到缺失段即停止。"""
    values = []
    for part in parts:
        if part is None or not part.isdigit():
            break
        values.append(part)
    return ".".join(values)[:32]


def _hint_browser(family: str, hints: CommentDeviceHints | None) -> tuple[str, str] | None:
    """在 UA 对应浏览器族内选择明确品牌，忽略 GREASE 和内核替代项。"""
    if hints is None or "WebView" in family:
        return None
    brands = {
        "Microsoft Edge": ("Edge", "Edge"),
        "Opera": ("Opera", "Opera"),
        "Brave": ("Brave", "Brave"),
        "Vivaldi": ("Vivaldi", "Vivaldi"),
        "Samsung Internet": ("Samsung Internet", "Samsung Internet"),
        "Google Chrome": ("Chrome", "Chrome"),
        "Chromium": ("Chromium", "Chromium"),
    }
    chromium = family.startswith(("Chrome", "Chromium", "HeadlessChrome"))
    for brand, (prefix, label) in brands.items():
        if brand == "Chromium" and not family.startswith("Chromium"):
            continue
        if not family.startswith(prefix) and not chromium:
            continue
        for item in hints.full_version_list:
            if item.brand == brand:
                version = item.version
                return label, version.split(".")[0] if version.endswith(".0.0.0") else version
    return None


def device_labels(
    user_agent: str, hints: CommentDeviceHints | None = None
) -> tuple[str | None, str | None]:
    """解析可展示版本，优先使用浏览器开放的 Client Hints。

    Args:
        user_agent: 当前提交的请求头，仅用于当次解析，不持久化。
        hints: 可选版本信息；缺失、被拒绝或平台不匹配时保守降级。

    Returns:
        浏览器与系统展示名称；无法区分 Windows 10/11 时标明版本未知，
        不把 Chromium 或 Safari 冻结的系统版本当作真实版本。
    """
    result = parse(user_agent[:1024])
    agent, os = result.user_agent, result.os
    browser = None
    if agent and agent.family != "Other":
        version = _version(agent.major, agent.minor, agent.patch, agent.patch_minor)
        # Chromium 的归零段是隐私占位，不能当作完整版本展示。
        if version.endswith(".0.0.0"):
            version = agent.major or ""
        browser = f"{agent.family} {version}".strip()
        hinted = _hint_browser(agent.family, hints)
        if hinted:
            browser = f"{hinted[0]} {hinted[1]}"

    if not os or os.family == "Other":
        return browser, None
    family = "macOS" if os.family == "Mac OS X" else os.family
    version = _version(os.major, os.minor, os.patch, os.patch_minor)
    if family == "Windows" and os.major in {"XP", "Vista", "ME", "NT", "RT"}:
        version = os.major
    frozen_chromium = bool(re.search(r"Chrome/\d+\.0\.0\.0(?:\s|$)", user_agent[:1024]))
    platforms = {
        "Windows": "Windows",
        "macOS": "macOS",
        "Android": "Android",
        "Chrome OS": "Chrome OS",
    }
    hinted_version = (
        hints.platform_version if hints and platforms.get(family) == hints.platform else None
    )
    if hinted_version and not any(int(part) for part in hinted_version.split(".")):
        hinted_version = None
    if family == "Windows" and version == "10":
        major = int(hinted_version.split(".")[0]) if hinted_version else None
        if major is not None and major >= 13:
            version = "11"
        elif major is not None and 1 <= major <= 10:
            version = "10"
        else:
            return browser, "Windows（版本未知）"
    elif hinted_version and family in {"macOS", "Android", "Chrome OS"}:
        version = hinted_version
    elif (
        (family == "macOS" and version in {"10.15", "10.15.7"})
        or (frozen_chromium and family in {"Android", "Chrome OS"})
        or (family == "iOS" and re.match(r"^18\.[67](?:\.|$)", version))
    ):
        # Safari 26 起冻结在 iOS 18.6/18.7；第三方 WebKit 也可能沿用该占位。
        version = ""
    return browser, f"{family} {version}".strip()


def lookup_region(host: str | None) -> str | None:
    """查询公网 IP 的省份或国家；无效、内网和上游失败均降级为空。

    Args:
        host: ASGI 提供的客户端地址，仅信任服务器已验证的代理链。

    Returns:
        中国展示省份，其他地区展示国家；不返回城市、坐标或 IP。
    """
    try:
        address = ip_address(host or "")
    except ValueError:
        return None
    if not address.is_global:
        return None
    try:
        with httpx.Client(timeout=2.0, trust_env=False) as client:
            response = client.get(
                f"https://ipwho.is/{address}",
                params={"lang": "zh-CN", "fields": "success,country,country_code,region"},
            )
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, dict) or data.get("success") is not True:
            return None
        value = data.get("region") if data.get("country_code") == "CN" else data.get("country")
        return value[:100] if isinstance(value, str) and value.strip() else None
    except (httpx.HTTPError, ValueError):
        return None


def qq_avatar(number: str) -> tuple[bytes, str] | None:
    """只向固定 QQ 图片源请求头像，限制图片大小和类型，失败交由前端回退。"""
    try:
        with (
            httpx.Client(timeout=3.0, trust_env=False) as client,
            client.stream(
                "GET", "https://q1.qlogo.cn/g", params={"b": "qq", "nk": number, "s": "100"}
            ) as response,
        ):
            response.raise_for_status()
            media_type = response.headers.get("content-type", "").split(";")[0]
            if media_type not in {"image/jpeg", "image/png", "image/gif", "image/webp"}:
                return None
            content = bytearray()
            for chunk in response.iter_bytes():
                content.extend(chunk)
                if len(content) > 1024 * 1024:
                    return None
            return (bytes(content), media_type) if content else None
    except httpx.HTTPError:
        return None
