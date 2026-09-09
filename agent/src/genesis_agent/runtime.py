from __future__ import annotations

from collections.abc import Sequence
from typing import Any, TypedDict, cast

from deepagents import create_deep_agent
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from genesis_agent.service import AgentPrompt


class BlogAgentState(TypedDict, total=False):
    """Genesis Agent 在 LangGraph 中流转的最小状态。"""

    messages: list[BaseMessage]
    context: dict[str, Any]
    intent: str
    proposed_actions: list[dict[str, Any]]
    result: dict[str, Any]


class BlogAgentRuntime:
    """把 LangChain 工具、LangGraph 编排和 DeepAgents 执行层组合起来。"""

    def __init__(
        self,
        model: BaseChatModel,
        tools: Sequence[BaseTool],
        checkpointer: BaseCheckpointSaver[Any] | None = None,
    ) -> None:
        self._deep_agent = create_deep_agent(
            model=model,
            tools=list(tools),
            system_prompt=AgentPrompt.system_message_from_capabilities(),
            interrupt_on={
                "create_draft": True,
                "update_post": True,
                "delete_post": True,
                "publish_post": True,
            },
            name="genesis-blog-agent",
        )
        graph = StateGraph(BlogAgentState)
        graph.add_node("prepare", self._prepare)
        graph.add_node("execute", self._execute)
        graph.add_edge(START, "prepare")
        graph.add_edge("prepare", "execute")
        graph.add_edge("execute", END)
        self._graph = graph.compile(checkpointer=checkpointer)

    @property
    def graph(self) -> Any:
        return self._graph

    async def ainvoke(
        self,
        messages: list[BaseMessage],
        *,
        context: dict[str, Any] | None = None,
    ) -> BlogAgentState:
        result = await self._graph.ainvoke({"messages": messages, "context": context or {}})
        return cast(BlogAgentState, result)

    @staticmethod
    def _prepare(state: BlogAgentState) -> dict[str, Any]:
        return {"intent": "blog_workflow", "proposed_actions": []}

    async def _execute(self, state: BlogAgentState) -> dict[str, Any]:
        context = state.get("context", {})
        messages = [
            SystemMessage(content=f"可信页面上下文：{context}"),
            *state.get("messages", []),
        ]
        result = await self._deep_agent.ainvoke(  # type: ignore[call-overload]
            {"messages": messages},
            context=context,
        )
        return {"result": cast(dict[str, Any], result)}
