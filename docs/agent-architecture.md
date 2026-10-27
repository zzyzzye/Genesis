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

这是 AG-UI 输出协议适配，不是开放通用 `RunAgentInput` 执行端点。官方 `ag-ui-langgraph` 可包装后端图，但其 FastAPI 辅助端点将图执行直接绑定到响应流，不能直接替换现有后台任务与独立订阅。当前保留 `ai/ag_ui.py` 将已授权的安全快照投影成官方事件，复用 `ag-ui-protocol` 类型和 `EventEncoder`，不接管 Agent 编排；权限与计费并不妨碍未来在后台执行层复用官方适配器。

## AG-UI 事件契约

| 事件 | Genesis 行为 |
| --- | --- |
| `RUN_STARTED` | 每个订阅先初始化任务；`runId` 为任务 ID，`threadId` 为公开会话 ID，无会话时使用任务 ID。 |
| `MESSAGES_SNAPSHOT` | 首次订阅、重连或正文重算时发送完整安全会话历史：用户正文、助手正文、工具调用与结果。当前任务使用最新正文和工具记录；无会话时仅包含当前任务。历史复用现有会话展示投影，不读取 checkpoint 或暴露系统提示词。 |
| `TEXT_MESSAGE_START/CONTENT/END` | 稳定的 `${runId}:assistant` 标识；`CONTENT.delta` 追加正文。 |
| `TOOL_CALL_START/ARGS/END/RESULT` | 首次快照以标准 `assistant.toolCalls` 与 `tool` 消息恢复已有工具，不再重复发送开始事件。后续调用通过标准增量传递；`ARGS` 固定为安全空对象 `{}`，`END` 表示参数流结束，执行完成看 `RESULT`。快照和事件的 `metadata.genesis` 只补充中文标签、状态、时间和提议关联；不发送原始参数值或原始结果。 |
| `STATE_SNAPSHOT` | `snapshot.genesis` 仅保存 `sequence/status/metrics/billing/proposals`，完整覆盖业务展示状态。工具记录不再重复放入业务状态。无新增正文时也传播状态变更。 |
| `RUN_FINISHED` | 先传播最终状态，再正常结束。 |
| `RUN_ERROR` | 先传播已生成内容和最终业务状态，再显示失败或停止说明。 |

消息快照与正文增量通过 `metadata.genesis.sequence` 携带内容修订号；它不是 token 数，也不是 SSE 事件总数。SSE 注释心跳仍为 `: keep-alive`。每次重连都先读取完整快照，无需依赖 `Last-Event-ID` 或浏览器保留旧增量。

前端 `lib/agUiStream.ts` 复用 `@ag-ui/client` 的 `HttpAgent` 处理解码、事件校验、消息和工具归并。子类仅把请求改成 GET，继续通过原有 `authFetch` 续期与鉴权。`onMessagesChanged` 向助手和 SVG 页面提供完整正文及工具展示，页面不再自行拼接 token；`onStateChanged` 转发计费、统计与操作提议。工具展示从官方消息状态读取，扩展字段优先使用结果消息上的最新 metadata，不维护第二套工具生命周期。

当前锁定的 `@ag-ui/client@1.0.3` 解码器按 LF 分帧，因此传输层使用 Web Streams 规范化 CRLF/CR，包括跨字节、跨分片的换行；这层不解析 SSE 或协议事件。终态、异常、离开页面时中止传输，网络正常结束但没有终态时返回 `disconnected`，助手沿用重订阅逻辑。协议顺序校验失败作为终态错误处理，避免反复重订阅同一非法消息流。

首次订阅才加载安全会话历史，后续轮询只读取当前任务；正文重算复用该订阅的历史并替换当前任务的正文和工具消息。JSON 任务与历史接口继续保留原来的 `tool_calls` 展示结构，供页面初始加载与显式停止核对，不增加另一份持久化数据。

## 业务功能与权限

- `ai_chat_runs` 保存用户归属、展示快照、修订号、工具记录和任务状态；LangGraph checkpoint 保存实际执行状态。AG-UI 不替代任一持久化层。
- 操作提议随 `snapshot.genesis.proposals` 传递，确认仍走独立的签名业务接口，服务端重新检查当前用户和权限；自动执行模式沿用原策略。
- 澄清问题、影音画布方案、Markdown 和 SVG 仍通过原正文与组件渲染；附件准备、模型选择、思考设置和对话历史请求保持现有业务契约。
- 工具标准消息与事件只包含已允许展示的名称、结果摘要与 metadata；不为协议完整性额外暴露工具原始输入、异常或文件内容。
- 不向前端发送内部 checkpoint、可信身份上下文或上游请求载荷。

## 验证

后端运行 Ruff、mypy 和 pytest；协议测试覆盖重连、正文重置、同序号业务更新、工具去重、失败、空回复、心跳和连接断开。前端运行 ESLint、类型检查、测试与构建，验证 AG-UI 分帧、结束后资源释放及原有助手业务回调。

通过已运行的 Compose 前端打开 `tests/browser/ag-ui.html`，使用真实组件与合成 API 验收正文、工具记录、提议确认、澄清提问、断线恢复、错误和停止；`tests/browser/billing.html?view=svg` 验证工具箱流式 SVG。验收页仅在本地开发模式运行，不调用真实模型或产生费用。

2026-10-27 官方客户端接入验收：Compose 容器内 Ruff、mypy、ESLint、TypeScript 与生产构建通过；后端 521 项测试通过，覆盖率 91.38%，前端 454 项测试通过（单 worker）。另将 Python 编码器实际产出的快照、工具增量和重算事件直接交给官方 JS 客户端，确认消息、工具结果和去重一致。浏览器检查博客、影音与 SVG，覆盖 1440px 桌面和 390px 窄屏，以及空态、正常、失败、停止、重连、重算、工具详情、提议确认和澄清选择；全部使用合成数据，未调用真实模型或产生费用。strict UI 静态审计零发现。保留既有 Pydantic 序列化警告与生产构建大分块提示。
