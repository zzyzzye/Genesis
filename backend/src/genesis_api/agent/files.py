"""将本次业务校验后的文档导入 DeepAgents 原生会话文件后端。"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

from deepagents.backends import StateBackend
from langchain.agents.middleware import AgentMiddleware, AgentState
from langgraph.runtime import Runtime

_files: ContextVar[list[tuple[str, bytes]] | None] = ContextVar("genesis_agent_files", default=None)


@contextmanager
def agent_files_context(files: list[tuple[str, bytes]]) -> Iterator[None]:
    """绑定已经解析的附件；并发调用各自隔离，退出即释放原始字节引用。"""
    token = _files.set(files)
    try:
        yield
    finally:
        _files.reset(token)


class AttachmentFilesMiddleware(AgentMiddleware[AgentState, None]):
    """仅在图执行内调用 upload_files，使文件进入现有 checkpoint 的 files 通道。"""

    async def abefore_agent(
        self,
        state: AgentState,
        runtime: Runtime[None],
    ) -> dict[str, Any] | None:
        """委托框架完成上传与状态写入，不自行维护文件状态或持久化协议。"""
        files = _files.get()
        if files:
            results = await StateBackend().aupload_files(files)
            if any(result.error for result in results):
                raise ValueError("导入会话附件失败，请重新发送")
        return None
