"""博客完整写操作返回提议或执行回执后，通过框架原生跳转结束本轮。"""

from langchain.agents.middleware import AgentState, before_model
from langchain_core.messages import ToolMessage
from langgraph.runtime import Runtime

from genesis_api.agent.contracts import AgentActionProposal
from genesis_api.blog.agent.context import tool_manifest

_WRITE_TOOLS = {str(item["name"]) for item in tool_manifest() if item["mode"] == "write"}


@before_model(can_jump_to=["end"])
def finish_after_blog_write(state: AgentState, runtime: Runtime[None]) -> dict[str, object] | None:
    """仅在完整写操作成功后结束；只读和校验错误继续由模型处理。

    Args:
        state: DeepAgents 当前消息状态，不读取推理元数据。
        runtime: 框架注入的运行时；终止和 checkpoint 仍由框架管理。

    Returns:
        成功返回原生 end 跳转，界面已接收提议或执行回执；其他情况不改变流程。
    """
    outputs = []
    for message in reversed(state["messages"]):
        if not isinstance(message, ToolMessage):
            break
        outputs.append(message)
    # 同批其他调用失败时，仍让模型处理错误，不能只展示成功卡片后提前结束。
    if any(message.status == "error" for message in outputs):
        return None
    for message in outputs:
        if message.name not in _WRITE_TOOLS:
            continue
        if not isinstance(message.content, str):
            continue
        try:
            proposal = AgentActionProposal.model_validate_json(message.content)
        except ValueError:
            continue
        if proposal.module == "blog":
            return {"jump_to": "end"}
    return None
