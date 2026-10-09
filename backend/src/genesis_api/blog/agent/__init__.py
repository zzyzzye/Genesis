"""博客模块拥有的 Agent 工具、上下文和写操作。

阅读顺序：capability.py 提供能力入口，prompt.py 定义系统指令，tools.py 注册
模型可调用工具，context.py 组织页面参考，actions.py 执行用户确认后的写入。
Agent 图创建、模型初始化与 checkpoint 由公共 genesis_api.agent 运行时负责。
"""
