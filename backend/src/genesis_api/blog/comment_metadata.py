"""评论来源适配：只保留粗粒度地区及解析后的浏览器、系统名称。"""

from ipaddress import ip_address

import httpx
from ua_parser import parse


def device_labels(user_agent: str) -> tuple[str | None, str | None]:
    """使用维护中的 UA 规则识别设备，不保留原始请求头或设备型号。"""
    result = parse(user_agent[:1024])
    browser = result.user_agent.family if result.user_agent else None
    system = result.os.family if result.os else None
    return (
        browser[:100] if browser and browser != "Other" else None,
        system[:100] if system and system != "Other" else None,
    )


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
