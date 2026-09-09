import json

from genesis_agent.tools import build_blog_tools, tool_manifest


def test_agent_tools_are_database_free_and_expose_confirmation_boundary() -> None:
    tools = {item.name: item for item in build_blog_tools()}
    assert "list_posts" in tools
    proposal = json.loads(
        tools["update_post"].invoke({"post_id": "post-1", "changes": '{"title":"新标题"}'})
    )
    assert proposal == {
        "type": "pending_action",
        "action": "update_post",
        "payload": {"post_id": "post-1", "changes": '{"title":"新标题"}'},
        "requires_confirmation": True,
    }


def test_tool_manifest_matches_agent_capabilities() -> None:
    names = {item["name"] for item in tool_manifest()}
    assert {"list_posts", "get_post", "create_draft", "publish_post"} <= names
    assert all("requires_confirmation" in item for item in tool_manifest())
