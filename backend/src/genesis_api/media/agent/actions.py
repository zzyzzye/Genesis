"""影音写工具复用公共签名提议，确认时重新校验作品归属与版本。"""

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from jwt import encode
from langchain_core.messages import ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool, StructuredTool, ToolException

from genesis_api.agent.context import (
    agent_invocation_context,
    automatic_actions_allowed,
    require_actor,
)
from genesis_api.agent.contracts import AgentActionProposal
from genesis_api.core.config import Settings
from genesis_api.identity.models import User
from genesis_api.media import service

MEDIA_ACTIONS = {
    "rename_node": "修改节点名称",
    "edit_media_canvas": "保存画布修改",
    "reference_media_asset": "关联作品素材",
    "submit_image_generation": "提交图片生成（可能计费）",
    "submit_video_generation": "提交视频生成（可能计费）",
    "retry_generation_save": "重试保存已有生成结果（不重新生成）",
}


async def execute_tool(
    entry: BaseTool, payload: dict[str, Any], config: RunnableConfig,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """通过原生工具调用保留参数验证、错误语义和资源回执。"""
    message = await entry.ainvoke(
        {"type": "tool_call", "id": str(uuid4()), "name": entry.name, "args": payload},
        config=config,
    )
    if not isinstance(message, ToolMessage) or message.status == "error":
        raise ToolException(str(getattr(message, "content", "操作执行失败")))
    content = json.loads(str(message.content))
    artifact = message.artifact if isinstance(message.artifact, dict) else {}
    return content, artifact


def reviewed_tool(entry: BaseTool, settings: Settings) -> BaseTool:
    """让同一个业务工具按可信执行模式返回待确认或已执行提议。"""
    async def invoke(config: RunnableConfig, **kwargs: Any) -> tuple[str, dict[str, Any]]:
        from genesis_api.media.agent.tools import SessionLocal

        try:
            actor = require_actor(module="media")
            with SessionLocal() as session:
                service.project_for(session, actor, UUID(str(kwargs["project_id"])))
        except (HTTPException, RuntimeError) as exc:
            raise ToolException(
                str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
            ) from None
        # 参数已由原工具的 schema 验证；转换为可签名、可恢复的 JSON。
        payload = json.loads(json.dumps(kwargs, default=lambda value: (
            value.model_dump(mode="json") if hasattr(value, "model_dump") else str(value)
        )))
        payload["_run_id"] = str(config.get("configurable", {}).get("genesis_run_id", ""))
        proposal_id = uuid4()
        expires = datetime.now(UTC) + timedelta(seconds=settings.agent_action_expire_seconds)
        token = encode({
            "proposal_id": str(proposal_id), "actor_id": str(actor), "module": "media",
            "action": entry.name, "payload": payload, "exp": expires,
        }, settings.agent_action_secret.get_secret_value(), algorithm="HS256")
        proposal = AgentActionProposal(
            proposal_id=proposal_id, module="media", action=entry.name, payload=payload,
            summary=MEDIA_ACTIONS[entry.name], expires_at=expires, proposal_token=token,
        )
        artifact: dict[str, Any] = {}
        if automatic_actions_allowed():
            result, artifact = await execute_tool(entry, kwargs, config)
            proposal.executed = True
            proposal.execution_result = {**result, **artifact}
        return proposal.model_dump_json(), artifact

    return StructuredTool(
        name=entry.name, description=entry.description + " 审阅模式仅创建提议，确认后才执行。",
        args_schema=entry.args_schema, coroutine=invoke, response_format="content_and_artifact",
        handle_tool_error=True, handle_validation_error=entry.handle_validation_error,
    )


async def confirm_media_action(
    action: str, payload: dict[str, Any], user: User, settings: Settings,
) -> dict[str, Any]:
    """执行验签后的提议；不信任客户端补充参数，不重建生成意图标识。"""
    from genesis_api.media.agent.tools import build_media_tools

    if action not in MEDIA_ACTIONS:
        raise ValueError("影音操作类型无效")
    entries = build_media_tools(settings, review=False)
    entry = next(item for item in entries if item.name == action)
    arguments = {key: value for key, value in payload.items() if key != "_run_id"}
    with agent_invocation_context(user.id, user.role.value, "media", execution_mode="automatic"):
        try:
            result, artifact = await execute_tool(entry, arguments, {
                "configurable": {"genesis_run_id": payload.get("_run_id")},
            })
        except ToolException as exc:
            raise HTTPException(422, str(exc)) from None
    return {**result, **artifact, "action": action}
