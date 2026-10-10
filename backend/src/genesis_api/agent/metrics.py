"""复用 LangChain 回调采集用量，按模型调用统计可见正文的输出速度。"""

from __future__ import annotations

from time import monotonic
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

from genesis_api.ai.schemas import AiGenerationMetrics


class GenerationMetrics(BaseCallbackHandler):
    """记录最后一段正文所属调用；缺少供应商用量时明确使用字符估算。"""

    def __init__(self) -> None:
        """仅保存统计所需计数，不复制提示词、工具参数或完整模型响应。"""
        self.started = monotonic()
        self.first: float | None = None
        self.latest_id: str | None = None
        self.calls: dict[str, tuple[float, float, int, int]] = {}
        self.usage: dict[str, int] = {}

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        """从框架完成消息读取供应商用量，扣除明确标记的推理 token。"""
        for generations in response.generations:
            for generation in generations:
                message = getattr(generation, "message", None)
                usage = getattr(message, "usage_metadata", None)
                message_id = getattr(message, "id", None)
                if not isinstance(usage, dict) or not isinstance(message_id, str):
                    continue
                output = usage.get("output_tokens")
                details = usage.get("output_token_details") or {}
                reasoning = details.get("reasoning", 0) if isinstance(details, dict) else 0
                if (
                    isinstance(output, int) and not isinstance(output, bool)
                    and isinstance(reasoning, int) and not isinstance(reasoning, bool)
                    and 0 <= reasoning <= output
                ):
                    self.usage[message_id] = output - reasoning

    def observe(self, message: object, text: str) -> None:
        """以服务端单调时钟记录正文片段，避免浏览器重连或批次大小影响测速。"""
        if not text:
            return
        now = monotonic()
        if self.first is None:
            self.first = now
        message_id = str(getattr(message, "id", None) or "unidentified")
        self.latest_id = message_id
        first, _, ascii_count, other_count = self.calls.get(message_id, (now, now, 0, 0))
        ascii_count += sum(ord(character) < 128 for character in text)
        other_count += sum(ord(character) >= 128 for character in text)
        self.calls[message_id] = (first, now, ascii_count, other_count)

    def snapshot(self) -> AiGenerationMetrics:
        """返回当前统计；单片段或耗时过短时速度不可用，不显示虚假的极大值。"""
        metrics = AiGenerationMetrics(
            first_token_seconds=self.first - self.started if self.first is not None else None,
            total_seconds=max(0, monotonic() - self.started),
        )
        if self.latest_id is None:
            return metrics
        first, last, ascii_count, other_count = self.calls[self.latest_id]
        count = self.usage.get(self.latest_id)
        source = "actual" if count is not None else "estimated"
        if count is None:
            # 中文等非 ASCII 字符按一字约一个 token，ASCII 按四字符约一个 token。
            count = max(1, round(other_count + ascii_count / 4))
        seconds = max(0, last - first)
        return metrics.model_copy(update={
            "output_tokens": count,
            "token_source": source,
            "output_seconds": seconds,
            "tokens_per_second": count / seconds if seconds >= 0.01 else None,
        })
