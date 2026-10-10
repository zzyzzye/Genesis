# Genesis API

Genesis 的 FastAPI 后端服务。

## 模型能力与请求协议

`llm/profiles.py` 将两种选择分开：

- `capability_provider_for` 按模型所属供应商读取 LangChain 原生 profile；能力数据来自依赖版本，不查询网关，也不维护项目自己的模型档位表。
- `transport_provider_for` 按现有连接配置选择实际请求适配器；已识别的兼容网关沿用 OpenAI 协议。

模型目录与运行时使用同一个原生 profile 查询思考档位。运行时还将该 profile 注入传输客户端，让 DeepAgents 获得原生模型能力；具体请求参数序列化仍交给 LangChain。

思考开关使用独立的 `thinking_mode` 字段，默认不传，支持时可选 `enabled` 或 `disabled`，不与 `reasoning_effort` 混用。框架尚未描述 MiMo 开关，`thinking_modes_for` 仅按[官方深度思考文档](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/text-generation/deep-thinking)补充明确支持的模型范围，不推断未知别名。发送依旧使用 ChatOpenAI 的 `extra_body={"thinking": {"type": ...}}`；MiMo 默认开启思考，未明确关闭时不传自定义温度。后台请求持久化与图缓存均保留该选项。

支持思考不等于支持可配置的强度档位。框架未提供档位的模型与未知模型仅使用默认，不根据名称或客户端字段类型猜测低、中、高；更新能力数据通过更新相应框架依赖完成。网关是否接受并执行这些参数仍由网关实现决定，原生 profile 不代表网关的兼容性保证。

```bash
uv sync --all-groups
uv run fastapi dev src/genesis_api/main.py
```
