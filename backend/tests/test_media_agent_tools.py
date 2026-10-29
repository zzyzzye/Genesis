"""验证影音规划使用真实模型限制，且目录失败时不编造能力。"""

import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from genesis_api.core.config import Settings
from genesis_api.media import video
from genesis_api.media.agent.tools import build_media_tools


def test_model_query_preserves_fixed_duration_and_unknown_parameters(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    catalog = AsyncMock(return_value=["v1-seedance-2.0-933-720p-15s", "new-video-model"])
    monkeypatch.setattr(video, "available_models", catalog)
    tool = build_media_tools(Settings())[0]

    result = asyncio.run(tool.ainvoke({}))

    assert result["models"][0]["durations"] == [15]
    assert result["models"][1] == {"id": "new-video-model", "parameters_known": False}
    assert result["editing_available"] is False
    filtered = asyncio.run(tool.ainvoke({"model_id": "new-video-model"}))
    assert filtered["models"] == [result["models"][1]]
    missing = asyncio.run(tool.ainvoke({"model_id": "unavailable-model"}))
    assert missing["models"] == []


def test_model_query_reports_service_failure_without_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        video, "available_models", AsyncMock(side_effect=HTTPException(502, "视频模型目录暂不可用"))
    )

    result = asyncio.run(build_media_tools(Settings())[0].ainvoke({}))

    assert result == "视频模型目录暂不可用"
