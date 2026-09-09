# Genesis Agent 解耦与工程化方案

## 目标

将 Agent 从 Genesis 业务后端中完全拆出：浏览器只访问 FastAPI，FastAPI 负责身份与业务权限，独立 Agent 负责 LangChain/LangGraph/DeepAgents 编排，Agent 不直接访问业务数据库。

## 运行边界

```text
Browser
  -> frontend:5173
  -> backend:8000 (JWT、Owner 权限、业务数据库、SSE)
  -> agent:8123 (LangGraph API)
  -> PostgreSQL (业务表 + LangGraph checkpoint 表)
```

`agent` 只通过 LangGraph SDK 接收消息和后端注入的可信 context。Agent 工具只生成分析结果或 `pending_action`，不执行 Genesis 业务写入。

## 三层职责

### Backend

- 校验 JWT、用户和 Owner 权限。
- 从业务数据库构造页面 context。
- 创建 `ai_chat_runs`，将 `run_id` 和 `thread_id` 绑定。
- 调用 LangGraph stream，并把事件转换为可恢复的 SSE。
- 校验用户确认后的 action，并执行博客写入。

### Agent

- 使用 `init_chat_model` 初始化 provider/model。
- 使用 `create_deep_agent` 执行工具和 Agent workflow。
- 使用 LangGraph `StateGraph` 编排 prepare/execute。
- 使用 `PostgresSaver` 持久化 thread/checkpoint/interrupt。
- 不导入 `genesis_api.blog`、`genesis_api.database` 或业务模型。

### Frontend

- 只调用 backend API。
- 保存 `run_id`，断线后重新连接 SSE。
- 展示 `pending_action`，用户确认后调用 backend action API。

## 持久化策略

- LangGraph checkpoint：Agent thread、graph state、interrupt 和恢复。
- `ai_chat_runs`：用户归属、前端 SSE 快照、sequence、业务状态。
- `thread_id` 是两者的稳定关联键，不能只凭 LangGraph thread 直接授权访问。

## 写入安全策略

```text
Agent proposal
  -> 前端确认
  -> Backend JWT + OwnerDependency
  -> Backend 重新读取数据库
  -> Pydantic schema 校验
  -> 事务提交
```

## 交付验证

后端必须通过 Ruff、mypy、pytest；前端必须通过 Docker Compose 中的 lint、类型检查，并在浏览器验证正常态、空态、proposal 确认态、断线恢复和窄屏布局。
