# Genesis Agent 与官方 AG-UI 集成

DeepAgents / LangGraph 负责模型、工具和 checkpoint。后端直接使用官方 `ag-ui-langgraph.LangGraphAgent` 包装现有图，前端使用官方 `@ag-ui/client.HttpAgent` 解码、验证和归并消息。

```text
后台任务 → DeepAgents / LangGraph → 官方 LangGraphAgent → 安全过滤
                                                      ↓
                                            PostgreSQL 公开事件日志
                                                      ↓
                                    GET SSE 订阅 → 官方 HttpAgent → 界面
```

## 官方适配器与业务边界

`genesis_api/agent/ag_ui.py` 中的 `AuthorizedLangGraphAgent` 只使用官方扩展点传入服务端已授权的消息、附件和回调，并保留 `durability="sync"`。checkpoint 恢复时传入 None，不重复提交用户消息。模型循环、事件转换、消息标识和工具生命周期全部由框架与官方适配器负责。

`PublicAgentEvents` 仅控制公开数据：移除系统消息、原始图状态、推理内容、工具参数和原始结果；保留官方消息与工具 ID；工具摘要、中文标签、耗时与状态复用既有 LangChain 回调。回调的 `protocol_id` 将安全展示记录关联到官方调用 ID，并用于恢复后的展示。

写操作提议仍须通过业务契约校验，确认接口仍验证签名和当前权限。澄清问题使用 `CUSTOM(genesis.question)` 传递经过契约校验的业务内容，界面继续复用原有澄清组件。这些业务适配不生成模型文本和工具生命周期。

SVG 使用 LangChain 原生无工具 Agent 图，也经由同一个官方适配器，继续沿用服务端固定的 MiMo 模型和 4096 token 限制。

## 后台执行、持久化与订阅

- `POST /api/v1/ai/chat/runs` 保留现有请求契约。授权、附件准备与计费准入后创建后台任务，返回 202 和任务 ID。
- `ai_chat_run_events` 按顺序追加安全过滤后的官方事件，不保存原始参数或私有图状态。事件批次与正文展示记录在同一事务提交。
- `ai_chat_runs` 继续保存任务状态、正文、安全工具历史、操作提议、统计和账务关联，供既有 JSON 接口与历史界面读取。
- `GET /api/v1/ai/chat/runs/{run_id}/stream` 按归属读取并重放事件，每批最多 512 条。订阅不调用图、不从文本快照重建文本增量或工具生命周期。
- `STATE_SNAPSHOT.genesis` 只承载业务的 `sequence/status/metrics/billing/proposals`。最终账务与业务状态发出后才发送终态。
- `GET /api/v1/ai/chat/runs/{run_id}` 保留 JSON 展示快照；`DELETE` 保留显式取消。关闭订阅不取消后台执行。
- 兼容入口 `POST /api/v1/ai/chat` 复用同一后台任务和订阅机制。

每次重连从该任务事件日志的起点重放，前端创建独立的官方客户端状态，因此不会重复追加到旧正文。消息与工具 ID 保持官方适配器产生的值，`metadata.genesis.run_id` 仅标识哪些消息属于当前任务。一个任务可以包含多个助手消息，不再压成一个合成消息 ID。

服务端恢复仍由原有任务管理器和 LangGraph checkpoint 承担。恢复时清理上次执行的展示事件，由官方适配器重新输出 checkpoint 的安全快照；已持久化的工具协议 ID 和摘要用于还原展示。已有账单未核对时，仍禁止自动重放付费请求。

## 前端消费

`lib/agUiStream.ts` 中的 `RunSubscriptionAgent` 只把 HttpAgent 请求改成 GET，并复用原有 `authFetch` 的登录续期与权限处理。标准事件解码、顺序验证、消息快照、正文归并和工具调用状态均由官方客户端完成。页面只接收完整正文及安全工具展示。

`@ag-ui/client@1.0.3` 的 SSE 解码器按 LF 分帧，因此传输层仅规范化跨分片 CRLF/CR，不自行解析 SSE 或协议事件。终态、错误与离开页面会释放传输；普通断线沿用业务重订阅，非法协议与权限失败不会被伪装成可无限重试的网络中断。

新接入不挂载官方 FastAPI 辅助端点：HTTP API 仍由现有任务系统拥有，后台执行则直接调用官方适配器。这不妨碍复用官方适配器，也不要求改动权限与计费边界。

## 既有记录兼容

`genesis_api/ai/ag_ui.py` 只为接入前没有事件日志的终态任务构建一次静态安全消息快照，方便读取既有历史。它不生成实时增量、不模拟工具执行，也不参与新任务的事件转换。原 `AgUiRunStream.project` 已删除。

## 验证

工程检查通过已运行的 Docker Compose 服务执行。后端覆盖真实 DeepAgents 图、官方适配器、原生 checkpoint 恢复、安全过滤、事件持久化、归属隔离、重连重放和最终账务顺序。前端覆盖官方多消息 ID、工具先于正文、快照覆盖、业务澄清、分片与换行、终态释放、取消和错误。

浏览器验收入口为 `tests/browser/ag-ui.html` 和 `tests/browser/billing.html?view=svg`，使用真实组件和合成 API；不调用真实模型、不产生费用。

2026-10-27 验证：Compose 内 Ruff、mypy、ESLint、TypeScript 和生产构建通过；后端 523 项测试通过，覆盖率 91.38%，前端 455 项测试通过。真实 DeepAgents 图经过官方 Python 适配器与安全过滤后的输出交给官方 JS 客户端验证，协议校验无警告；另外验证 SVG 原生无工具图保留固定输出限制。浏览器检查桌面与 390px 窄屏的正常、空回复、失败、重连、工具展开、澄清选择以及影音和 SVG 展示；strict UI 审计零发现。保留官方适配器的 LangGraph 弃用提示、既有 Pydantic 警告与构建大分块提示。
