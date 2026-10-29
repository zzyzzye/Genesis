"""按实际目录地址和认证协议复用上游目录，避免节点重复请求。"""

import asyncio
import hashlib
import json
from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass
from time import monotonic
from typing import Any

import httpx


class CatalogFormatError(ValueError):
    """目录结构无效，不将响应正文带入异常。"""


@dataclass
class CatalogEntry:
    """保存成功目录与短暂失败后的重试时间。"""

    payload: dict[str, Any]
    loaded_at: float
    retry_at: float = 0


class ModelCatalog:
    """同渠道共享五分钟缓存及在途请求；失败最多保留半小时旧目录。"""

    def __init__(self) -> None:
        self.entries: OrderedDict[str, CatalogEntry] = OrderedDict()
        self.pending: dict[str, asyncio.Task[dict[str, Any]]] = {}

    async def get(
        self, url: str, headers: dict[str, str], *, refresh: bool = False,
        client: httpx.AsyncClient | None = None,
    ) -> dict[str, Any]:
        """获取独立副本，缓存身份不包含明文凭据，也不混入用户价格或权限。

        Args:
            url: 最终模型目录地址。
            headers: 认证和协议头；大小写及默认 JSON Accept 归一化。
            refresh: 主动刷新绕过有效期，仍合并正在进行的请求。
            client: 测试或调用方管理的客户端，不由目录层关闭。

        Returns:
            最近成功的完整原始目录；首次请求失败仍向调用方报错。
        """
        normalized = {key.lower(): value for key, value in headers.items()}
        normalized.setdefault("accept", "application/json")
        identity = hashlib.sha256(
            json.dumps([url, sorted(normalized.items())]).encode()
        ).hexdigest()
        entry = self.entries.get(identity)
        now = monotonic()
        if entry and not refresh and (
            now - entry.loaded_at < 300
            or (now - entry.loaded_at < 1800 and now < entry.retry_at)
        ):
            self.entries.move_to_end(identity)
            return deepcopy(entry.payload)
        task = self.pending.get(identity)
        if task is None:
            task = asyncio.create_task(self._load(identity, url, normalized, client))
            self.pending[identity] = task

            def finished(done: asyncio.Task[dict[str, Any]]) -> None:
                self.pending.pop(identity, None)
                # 发起页面取消后，请求仍可完成并写缓存；回收无人等待的异常。
                if not done.cancelled():
                    done.exception()

            task.add_done_callback(finished)
        return deepcopy(await asyncio.shield(task))

    async def _load(
        self, identity: str, url: str, headers: dict[str, str],
        client: httpx.AsyncClient | None,
    ) -> dict[str, Any]:
        """仅缓存结构正确的成功结果，鉴权失败立即清除旧目录。"""
        response: httpx.Response | None = None
        try:
            if client is None:
                async with httpx.AsyncClient(timeout=15, trust_env=False) as owned:
                    response = await owned.get(url, headers=headers)
            else:
                response = await client.get(url, headers=headers)
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or not isinstance(
                payload.get("data", payload.get("models")), list
            ):
                raise CatalogFormatError("模型目录响应格式无效")
        except (httpx.HTTPError, ValueError):
            entry = self.entries.get(identity)
            denied = response is not None and response.status_code in (401, 403)
            if denied:
                self.entries.pop(identity, None)
            elif entry and monotonic() - entry.loaded_at < 1800:
                entry.retry_at = monotonic() + 15
                return entry.payload
            raise
        self.entries[identity] = CatalogEntry(payload, monotonic())
        self.entries.move_to_end(identity)
        while len(self.entries) > 128:
            self.entries.popitem(last=False)
        return payload


model_catalog = ModelCatalog()
