# Genesis API

Genesis 的 FastAPI 后端服务。

## 模型能力与请求协议

模型能力统一通过 `llm/capabilities.py` 的 `model_capabilities_for(provider, model)` 查询，模型目录和 Agent 运行时共用这个入口：

- 优先使用 LangChain 原生 profile 的 `max_input_tokens`、`max_output_tokens`、`reasoning_effort_levels` 与默认档位；保留其工具调用等其他字段，统一注入模型客户端供 DeepAgents 使用。
- 框架缺失的能力集中放在 `llm/capability_supplements.toml`，精确匹配供应商与模型 ID。配置经过 Pydantic 校验，仅填补缺失字段，不覆盖框架已有值；来源和核实日期写在配置旁。更新配置后重启后端。
- `profiles.py` 仅负责框架 profile 读取与传输适配器选择。网关协议不改变模型能力来源；请求参数序列化继续交给 LangChain 和必要的 MiMo 协议适配。

目录响应的 `context_window` 沿用现有 API 字段，用框架输入上限补齐，不能理解为“输入上限加输出上限”。目录明确返回的有效 `context_window` / `context_length` / Gemini `inputTokenLimit` 与 `max_output_tokens` / Gemini `outputTokenLimit` 优先用于该目录展示。它们可能反映网关自身限制，不写入原生模型能力。已删除原来单独的上下文表；框架和官方资料都无法确认的旧型号保持未知。

`max_output_tokens` 表示模型能力上限，`Settings.text_max_tokens` 表示本次请求预算。运行时发送两者较小值；上限未知时沿用请求预算，不自行设置无限大。网关若另有限制仍可能拒绝请求，不把原生上限当作网关保证。

思考开关 `thinking_mode` 与强度 `reasoning_effort` 独立；未传值沿用模型默认。`thinking_mode_default` 仅描述默认行为。MiMo 补充来自[模型列表](https://mimo.mi.com/docs/zh-CN/quick-start/summary/model)和[深度思考文档](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/text-generation/deep-thinking)：五个文本模型支持开关，默认开启，没有可配置强度；长度按官方 1M / 128K 的十进制数值记录。发送使用 `extra_body={"thinking": {"type": ...}}`，未明确关闭时不传自定义温度。后台请求持久化与图缓存均保留开关。

Grok 4.5 / 4.6 / 4.7 缺失档位按[官方推理文档](https://docs.x.ai/developers/model-capabilities/text/reasoning)补充，不能关闭思考；4.7 输入长度来自[模型说明](https://docs.x.ai/developers/grok-4-7)。官方未设独立文本输出上限时不编造数字。字段缺失（API 返回 null）表示未知或没有可用数值，空列表表示已确认没有该选项，不能将未知当作不支持。新增模型先检查框架；只有缺失且有官方依据的字段才加入静态补充，不模糊继承型号或网关别名。

```bash
uv sync --all-groups
uv run fastapi dev src/genesis_api/main.py
```
