import asyncio
import json

import pytest

from genesis_agent.tools import build_blog_tools, tool_manifest


def test_agent_tools_call_backend_preview(monkeypatch: pytest.MonkeyPatch) -> None:
    tools = {item.name: item for item in build_blog_tools()}

    async def preview(
        _self: object, action: str, payload: dict[str, object]
    ) -> str:
        return json.dumps({"action": action, "payload": payload}, ensure_ascii=False)

    monkeypatch.setattr("genesis_agent.backend_client.BackendApiClient.preview", preview)
    result = asyncio.run(
        tools["update_post"].ainvoke(
            {"post_id": "post-1", "changes": '{"title":"新标题"}'}
        )
    )

    assert json.loads(result) == {
        "action": "update_post",
        "payload": {"post_id": "post-1", "changes": '{"title":"新标题"}'},
    }


def test_tool_manifest_matches_agent_capabilities() -> None:
    names = {item["name"] for item in tool_manifest()}
    assert {"list_posts", "get_post", "create_draft", "publish_post"} <= names
    assert all("requires_confirmation" in item for item in tool_manifest())
