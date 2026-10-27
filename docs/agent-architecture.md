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

## 重复实现复查

后台流式服务只接收官方 `BaseEvent` 和业务提议，不再兼容旧字符串流或旧服务签名。旧的 `_message_text` 提取函数和未使用的 `AiProviderError` 已删除。结构化生成使用 `with_structured_output(schema).ainvoke()`，完整响应的聚合与 Pydantic 校验交给 LangChain；项目不再遍历结构化流或重复解析结果。工具展示直接复用记录内的 `protocol_id`，不另存一份 ID 映射。

| 能力 | 实际负责方与保留边界 |
| --- | --- |
| 模型循环、工具调度、任务清单、虚拟文件与上下文管理 | DeepAgents / LangChain 原生图和默认中间件；附件中间件只将业务授权文件交给 `StateBackend.aupload_files`。 |
| checkpoint、恢复与清理 | 原生 checkpointer、图恢复及 `PostgresSaver.delete_thread`；业务层只决定哪些用户任务可恢复、何时取消及如何核账。 |
| 消息、工具协议事件及前端归并 | 官方 LangGraphAgent 与 HttpAgent；项目只过滤私有载荷、补充安全展示并持久化公开事件。 |
| 澄清或博客写操作后结束本轮 | 原生 `before_model` 跳转扩展点，补充“成功且符合业务契约才结束”的条件；`return_direct` 会连工具校验失败一起结束，不能保持错误修正行为。 |
| 供应商与文档回退 | 仅保留 MiMo 思考字段回传、明确不支持 Responses 时的单次协议切换，以及已授权 PDF / DOCX 的文本转换；不替代原生模型或工具重试循环。 |
| 任务快照、工具摘要、统计与账务 | 业务展示与归属数据，不保存第二份图执行状态；事件订阅与后台执行的生命周期独立。 |

以上对照当前锁定依赖的实际源码检查；未以删除业务权限、审阅签名、计费或恢复能力换取代码量减少。LangChain 原生结构化输出说明见[官方模型文档](https://docs.langchain.com/oss/python/langchain/models#structured-output)。

## 验证

工程检查通过已运行的 Docker Compose 服务执行。后端覆盖真实 DeepAgents 图、官方适配器、原生 checkpoint 恢复、安全过滤、事件持久化、归属隔离、重连重放和最终账务顺序。前端覆盖官方多消息 ID、工具先于正文、快照覆盖、业务澄清、分片与换行、终态释放、取消和错误。

浏览器验收入口为 `tests/browser/ag-ui.html` 和 `tests/browser/billing.html?view=svg`，使用真实组件和合成 API；不调用真实模型、不产生费用。

2026-10-27 验证：Compose 内 Ruff、mypy、ESLint、TypeScript 和生产构建通过；后端 523 项测试通过，覆盖率 91.38%，前端 455 项测试通过。真实 DeepAgents 图经过官方 Python 适配器与安全过滤后的输出交给官方 JS 客户端验证，协议校验无警告；另外验证 SVG 原生无工具图保留固定输出限制。浏览器检查桌面与 390px 窄屏的正常、空回复、失败、重连、工具展开、澄清选择以及影音和 SVG 展示；strict UI 审计零发现。保留官方适配器的 LangGraph 弃用提示、既有 Pydantic 警告与构建大分块提示。

同日重复实现复查后的验证：Compose 内 Ruff、mypy（145 个源文件）通过；完整后端 521 项测试通过，覆盖率 91.42%（移除两项仅测试废弃文本提取函数的测试）。补充真实官方适配器的推理内容隔离与结构化响应分片回归，定向 23 项通过；前端 AG-UI/API 协议测试 9 项通过。本轮未修改前端代码；既有弃用及序列化警告保留。
