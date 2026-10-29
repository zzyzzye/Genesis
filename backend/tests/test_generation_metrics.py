"""验证真实用量、估算、单片段不可测速与多轮工具调用的统计口径。"""

from types import SimpleNamespace
from typing import Any

import pytest
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from genesis_api.agent import metrics as metrics_module
from genesis_api.agent.metrics import GenerationMetrics


def test_metrics_cover_all_visible_calls_and_exclude_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = [0.0]
    monkeypatch.setattr(metrics_module, "monotonic", lambda: clock[0])
    tracker = GenerationMetrics()
    assert tracker.snapshot().token_source == "unavailable"
    clock[0] = 1
    tracker.observe(SimpleNamespace(id="initial"), "先查资料")
    tracker.on_llm_end(
        LLMResult(
            generations=[
                [
                    ChatGeneration(
                        message=AIMessage(
                            id="initial",
                            content="先查资料",
                            usage_metadata={
                                "input_tokens": 10,
                                "output_tokens": 10,
                                "total_tokens": 20,
                            },
                        )
                    )
                ]
            ]
        )
    )
    clock[0] = 5
    tracker.observe(SimpleNamespace(id="final"), "最终正文")
    clock[0] = 7
    tracker.observe(SimpleNamespace(id="final"), "完成")
    result = LLMResult(
        generations=[
            [
                ChatGeneration(
                    message=AIMessage(
                        id="final",
                        content="最终正文完成",
                        usage_metadata={
                            "input_tokens": 20,
                            "output_tokens": 100,
                            "total_tokens": 120,
                            "output_token_details": {"reasoning": 20},
                        },
                    )
                )
            ]
        ]
    )
    tracker.on_llm_end(result)
    clock[0] = 8
    metrics = tracker.snapshot()
    assert metrics.output_tokens == 90
    assert metrics.tokens_per_second == 15
    assert metrics.output_seconds == 6
    assert metrics.first_token_seconds == 1
    assert metrics.total_seconds == 7
    assert metrics.total_seconds == metrics.first_token_seconds + metrics.output_seconds
    assert metrics.token_source == "actual"
    assert metrics.input_tokens == 20


def test_multiple_calls_with_missing_usage_are_aggregated(monkeypatch: pytest.MonkeyPatch) -> None:
    """工具等待计入输出区间；任何正文调用缺少用量时标记整体为估算。"""
    clock = [0.0]
    monkeypatch.setattr(metrics_module, "monotonic", lambda: clock[0])
    tracker = GenerationMetrics()
    clock[0] = 2
    tracker.observe(SimpleNamespace(id="initial"), "先查")
    clock[0] = 10
    tracker.observe(SimpleNamespace(id="final"), "完成")
    tracker.usage["final"] = 6
    clock[0] = 20
    metrics = tracker.snapshot()
    assert metrics.first_token_seconds == 2
    assert metrics.output_seconds == 8
    assert metrics.total_seconds == 10
    assert metrics.output_tokens == 8
    assert metrics.tokens_per_second == 1
    assert metrics.token_source == "estimated"


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
    bad: Any = SimpleNamespace(
        generations=[
            [
                SimpleNamespace(
                    message=SimpleNamespace(
                        id="visible",
                        usage_metadata={
                            "output_tokens": 2,
                            "output_token_details": {"reasoning": 5},
                        },
                    )
                ),
                SimpleNamespace(message=None),
            ]
        ]
    )
    tracker.on_llm_end(bad)
    assert tracker.snapshot().token_source == "estimated"


def test_context_input_uses_latest_call_including_tool_only_responses() -> None:
    """上下文取供应商整次输入，不累加工具轮次，也不依赖可见正文或输出用量。"""
    tracker = GenerationMetrics()
    tracker.input_provider, tracker.input_model = "mimo", "synthetic-model"
    for count in (12000, 18000):
        tracker.on_llm_end(
            LLMResult(
                generations=[
                    [
                        ChatGeneration(
                            message=AIMessage(
                                content="",
                                usage_metadata={
                                    "input_tokens": count,
                                    "output_tokens": 10,
                                    "total_tokens": count + 10,
                                },
                            )
                        )
                    ]
                ]
            )
        )
    snapshot = tracker.snapshot()
    assert snapshot.input_tokens == 18000
    assert snapshot.input_provider == "mimo" and snapshot.input_model == "synthetic-model"
    assert snapshot.output_tokens is None
    tracker.on_llm_end(LLMResult(generations=[[ChatGeneration(message=AIMessage(content="完成"))]]))
    assert tracker.snapshot().input_tokens is None


@pytest.mark.parametrize("count", [None, True, -1, "12000"])
def test_context_input_rejects_invalid_usage(count: Any) -> None:
    """无有效供应商用量时不沿用旧值或从正文长度猜测。"""
    tracker = GenerationMetrics()
    tracker.input_tokens = 12345
    response: Any = SimpleNamespace(
        generations=[
            [
                SimpleNamespace(
                    message=SimpleNamespace(
                        id="synthetic",
                        usage_metadata={"input_tokens": count},
                    )
                )
            ]
        ]
    )
    tracker.on_llm_end(response)
    assert tracker.snapshot().input_tokens is None


def test_failed_latest_model_call_clears_previous_context_usage() -> None:
    tracker = GenerationMetrics()
    tracker.input_tokens = 18000
    tracker.on_llm_error(RuntimeError("合成模型错误"))
    assert tracker.snapshot().input_tokens is None
