# Genesis Agent 运行时与 AG-UI 消息流

浏览器只访问 FastAPI。DeepAgents / LangGraph 在后端执行 Agent，负责工具调用、checkpoint 和恢复；前后端通过 AG-UI 事件同步回复，继续使用现有博客、影音和工具箱界面。

## 执行与订阅边界

```text
Browser -> frontend:5173 -> backend:8000 /api/v1
                           ├─ 身份、业务权限、任务与计费
                           ├─ DeepAgents / LangGraph -> 模型与业务工具
                           └─ PostgreSQL：业务数据、输出快照、checkpoint
```

- `POST /api/v1/ai/chat/runs` 保留业务请求契约，先授权、准备附件与计费，再创建后台任务，返回 `202` 和任务 ID。
- `GET /api/v1/ai/chat/runs/{run_id}/stream` 输出 AG-UI SSE。每次查询仍按登录用户筛选；连接断开仅停止订阅，不取消生成。
- `GET /api/v1/ai/chat/runs/{run_id}` 保留 JSON 任务快照接口，供历史恢复和停止后的核对。
- `DELETE /api/v1/ai/chat/runs/{run_id}` 保留显式取消接口；已生成内容、统计与计费状态仍可读取。
- 兼容入口 `POST /api/v1/ai/chat` 也使用同一 AG-UI 输出，不再发送旧的 `snapshot/token/done` 自定义事件。

这是 AG-UI 输出协议适配，不是开放通用 `RunAgentInput` 执行端点。不能直接套用 LangGraph 的独立 HTTP 执行入口：Genesis 的生成生命周期独立于订阅连接，并且必须经过业务身份、附件、写操作授权与计费。`ai/ag_ui.py` 只投影已授权的安全快照，复用官方 `ag-ui-protocol` 类型和 `EventEncoder`，不接管 Agent 编排。

## AG-UI 事件契约

| 事件 | Genesis 行为 |
| --- | --- |
| `RUN_STARTED` | 每个订阅先初始化任务；`runId` 为任务 ID，`threadId` 为公开会话 ID，无会话时使用任务 ID。 |
| `MESSAGES_SNAPSHOT` | 首次订阅、重连或正文重算时覆盖当前助手消息，防止重复追加。仅含当前任务消息，不含模型系统提示词。 |
| `TEXT_MESSAGE_START/CONTENT/END` | 稳定的 `${runId}:assistant` 标识；`CONTENT.delta` 追加正文。 |
| `TOOL_CALL_START/END/RESULT` | 真实工具调用的安全展示投影；`END` 表示参数流结束，执行完成看 `RESULT`。不发送原始参数值或原始结果。 |
| `STATE_SNAPSHOT` | `snapshot.genesis` 保存 `sequence/status/metrics/billing/proposals/tool_calls`，完整覆盖业务展示状态。无新增正文时也传播状态变更。 |
| `RUN_FINISHED` | 先传播最终状态，再正常结束。 |
| `RUN_ERROR` | 先传播已生成内容和最终业务状态，再显示失败或停止说明。 |

消息快照与正文增量通过 `metadata.genesis.sequence` 携带内容修订号；它不是 token 数，也不是 SSE 事件总数。SSE 注释心跳仍为 `: keep-alive`。每次重连都先读取完整快照，无需依赖 `Last-Event-ID` 或浏览器保留旧增量。

前端 `lib/agUiStream.ts` 使用 `eventsource-parser` 处理 UTF-8 分片、CRLF、心跳和 SSE 分帧，使用 `@ag-ui/core` 官方 schema 校验事件，再映射到原来的 `onSnapshot/onToken/onMetrics/onBilling/onProposals/onToolCalls` 回调。终态、异常、离开页面时释放 reader，网络中断没有终态时返回 `disconnected`，现有助手继续自动重连。

## 业务功能与权限

- `ai_chat_runs` 保存用户归属、展示快照、修订号、工具记录和任务状态；LangGraph checkpoint 保存实际执行状态。AG-UI 不替代任一持久化层。
- 操作提议随 `snapshot.genesis.proposals` 传递，确认仍走独立的签名业务接口，服务端重新检查当前用户和权限；自动执行模式沿用原策略。
- 澄清问题、影音画布方案、Markdown 和 SVG 仍通过原正文与组件渲染；附件准备、模型选择、思考设置和对话历史请求保持现有业务契约。
- 工具标准事件只包含已允许展示的名称与结果摘要，详细展示状态来自 `tool_calls`；不为协议完整性额外暴露工具原始输入、异常或文件内容。
- 不向前端发送内部 checkpoint、可信身份上下文或上游请求载荷。

## 验证

后端运行 Ruff、mypy 和 pytest；协议测试覆盖重连、正文重置、同序号业务更新、工具去重、失败、空回复、心跳和连接断开。前端运行 ESLint、类型检查、测试与构建，验证 AG-UI 分帧、结束后资源释放及原有助手业务回调。

通过已运行的 Compose 前端打开 `tests/browser/ag-ui.html`，使用真实组件与合成 API 验收正文、工具记录、提议确认、澄清提问、断线恢复、错误和停止；`tests/browser/billing.html?view=svg` 验证工具箱流式 SVG。验收页仅在本地开发模式运行，不调用真实模型或产生费用。
