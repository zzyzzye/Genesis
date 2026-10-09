"""博客领域：模型、请求与响应校验、业务服务及 Agent 能力。

HTTP 路由位于 genesis_api.api.routes，负责认证与接口编排；本包集中承载博客业务。
阅读数据流时先看 schemas.py 的输入输出契约，再看 models.py 的存储关系和
service.py 的查询写入规则；Agent 能力在 agent/ 内，复用同一套业务服务。
"""
