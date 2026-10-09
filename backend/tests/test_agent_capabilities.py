"""验证业务能力注册、模块入口兼容与未知模块的拒绝行为。"""

import pytest

from genesis_api.agent.capabilities import AgentCapabilityRegistry
from genesis_api.core.config import Settings
from genesis_api.media.agent import MediaAgentCapability
from genesis_api.media.agent.prompt import MediaAgentPrompt


def test_media_package_preserves_prompt_and_public_entry() -> None:
    capability = AgentCapabilityRegistry().resolve("media", Settings())
    assert capability.prompt == MediaAgentPrompt.system_message()
    assert capability.name == MediaAgentCapability.name
    assert "canvas-plan" in capability.prompt
    assert capability.tools == []


def test_toolbox_shell_is_registered_without_business_tools() -> None:
    capability = AgentCapabilityRegistry().resolve("toolbox", Settings())
    assert capability.module == "toolbox"
    assert capability.name == "genesis-toolbox-agent"
    assert "尚未接入" in capability.prompt
    assert capability.tools == []


def test_unknown_module_is_rejected() -> None:
    with pytest.raises(ValueError, match="尚未提供 Agent 能力"):
        AgentCapabilityRegistry().resolve("unknown", Settings())
