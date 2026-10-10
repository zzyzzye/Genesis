"""验证真实用量、估算、单片段不可测速与多轮工具调用的统计口径。"""

from types import SimpleNamespace
from typing import Any

import pytest
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from genesis_api.agent import metrics as metrics_module
from genesis_api.agent.metrics import GenerationMetrics


def test_metrics_use_native_usage_and_last_visible_call(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [0.0]
    monkeypatch.setattr(metrics_module, "monotonic", lambda: clock[0])
    tracker = GenerationMetrics()
    assert tracker.snapshot().token_source == "unavailable"
    clock[0] = 1
    tracker.observe(SimpleNamespace(id="initial"), "先查资料")
    clock[0] = 5
    tracker.observe(SimpleNamespace(id="final"), "最终正文")
    clock[0] = 7
    tracker.observe(SimpleNamespace(id="final"), "完成")
    result = LLMResult(generations=[[ChatGeneration(message=AIMessage(
        id="final", content="最终正文完成", usage_metadata={
            "input_tokens": 20, "output_tokens": 100, "total_tokens": 120,
            "output_token_details": {"reasoning": 20},
        },
    ))]])
    tracker.on_llm_end(result)
    clock[0] = 8
    metrics = tracker.snapshot()
    assert metrics.output_tokens == 80
    assert metrics.tokens_per_second == 40
    assert metrics.output_seconds == 2
    assert metrics.first_token_seconds == 1
    assert metrics.total_seconds == 8
    assert metrics.token_source == "actual"


def test_missing_usage_is_estimated_and_one_chunk_has_no_speed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = [0.0]
    monkeypatch.setattr(metrics_module, "monotonic", lambda: clock[0])
    tracker = GenerationMetrics()
    tracker.observe(None, "")
    tracker.observe(None, "中文abcd")
    assert tracker.snapshot().output_tokens == 3
    assert tracker.snapshot().token_source == "estimated"
    assert tracker.snapshot().tokens_per_second is None
    clock[0] = 1
    tracker.observe(None, "继续")
    assert tracker.snapshot().tokens_per_second == 5


def test_bad_or_unrelated_usage_does_not_claim_real_tokens() -> None:
    tracker = GenerationMetrics()
    tracker.observe(SimpleNamespace(id="visible"), "正文")
    bad: Any = SimpleNamespace(generations=[[SimpleNamespace(message=SimpleNamespace(
        id="visible", usage_metadata={"output_tokens": 2, "output_token_details": {"reasoning": 5}},
    )), SimpleNamespace(message=None)]])
    tracker.on_llm_end(bad)
    assert tracker.snapshot().token_source == "estimated"
