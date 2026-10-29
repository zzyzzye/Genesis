"""为 Gemini SDK 的同步和异步请求提供直连传输。"""

import httpx


class DirectGoogleTransport(httpx.BaseTransport, httpx.AsyncBaseTransport):
    """适配 LangChain 共用的 client_args，阻止 SDK 切换到环境代理路径。

    LangChain 将同一组参数交给同步和异步客户端，因此传输同时实现
    两个 httpx 接口；显式传输也让 Google SDK 使用 httpx 而非默认 aiohttp。
    连接池由 SDK 客户端按各自生命周期关闭。
    """

    def __init__(self) -> None:
        """创建不读取环境配置的同步和异步连接池。"""
        self._sync = httpx.HTTPTransport(trust_env=False)
        self._async = httpx.AsyncHTTPTransport(trust_env=False)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        """同步请求直接交给 httpx 连接池。"""
        return self._sync.handle_request(request)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        """异步请求直接交给 httpx 连接池。"""
        return await self._async.handle_async_request(request)

    def close(self) -> None:
        """释放同步连接。"""
        self._sync.close()

    async def aclose(self) -> None:
        """释放异步连接。"""
        await self._async.aclose()
