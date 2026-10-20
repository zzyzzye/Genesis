"""使用框架原生接口清理执行线程，事务与调用方的业务写入保持一致。"""

from collections.abc import Iterable

from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import Connection


def delete_agent_threads(connection: object, thread_ids: Iterable[str]) -> None:
    """在现有 PostgreSQL 事务内清理线程，不另开连接或自行提交。

    Args:
        connection: 业务会话当前持有的 psycopg 连接。
        thread_ids: 已经通过业务归属校验且没有运行任务的线程标识。

    Raises:
        TypeError: 调用方未使用项目约定的 PostgreSQL 连接。
    """
    if not isinstance(connection, Connection):
        raise TypeError("清理 Agent 执行记录需要 PostgreSQL 连接")
    saver = PostgresSaver(connection)
    for thread_id in dict.fromkeys(thread_ids):
        saver.delete_thread(thread_id)
