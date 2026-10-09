"""在 ChatOpenAI 的转换扩展点保留 MiMo 多轮工具调用要求的思考字段。"""

from typing import Any

import openai
from langchain_core.language_models import LanguageModelInput
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGenerationChunk, ChatResult
from langchain_openai import ChatOpenAI


class ChatMiMo(ChatOpenAI):
    """保留小米思考模式在多轮工具调用中要求回传的 reasoning_content。"""

    def _convert_chunk_to_generation_chunk(
        self,
        chunk: dict[str, Any],
        default_chunk_class: type,
        base_generation_info: dict[str, Any] | None,
    ) -> ChatGenerationChunk | None:
        """沿用框架流式转换，并把思考字段附加到模型消息元数据。

        Args:
            chunk: 上游返回的流式数据块，可包含 choices 或嵌套 chunk。
            default_chunk_class: 框架选择的默认消息片段类型。
            base_generation_info: 框架生成元数据，原样传给父类。

        Returns:
            转换后的消息片段；父类未生成有效片段时返回 None。
        """
        result = super()._convert_chunk_to_generation_chunk(
            chunk, default_chunk_class, base_generation_info
        )
        # 复用 ChatOpenAI 的标准消息转换，仅补充供应商要求保留的额外字段。
        choices = chunk.get("choices") or chunk.get("chunk", {}).get("choices", [])
        if result is not None and choices:
            reasoning = (choices[0].get("delta") or {}).get("reasoning_content")
            if isinstance(reasoning, str):
                result.message.additional_kwargs["reasoning_content"] = reasoning
        return result

    def _create_chat_result(
        self,
        response: dict[str, Any] | openai.BaseModel,
        generation_info: dict[str, Any] | None = None,
    ) -> ChatResult:
        """转换完整响应，并保留各候选回答的 reasoning_content。

        Args:
            response: 字典或 OpenAI SDK 响应对象。
            generation_info: 框架生成元数据，原样传给父类。

        Returns:
            由父类构建并补充思考元数据的聊天结果。

        Raises:
            ValueError: 框架生成结果与上游候选回答数量不一致。
        """
        result = super()._create_chat_result(response, generation_info)
        payload = response if isinstance(response, dict) else response.model_dump()
        for generation, choice in zip(result.generations, payload.get("choices", []), strict=True):
            reasoning = choice.get("message", {}).get("reasoning_content")
            if isinstance(reasoning, str):
                generation.message.additional_kwargs["reasoning_content"] = reasoning
        return result

    def _get_request_payload(
        self,
        input_: LanguageModelInput,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """构建标准请求载荷，并回传历史模型消息中的思考字段。

        Args:
            input_: 框架支持的提示词或消息输入。
            stop: 可选停止序列，沿用父类处理。
            **kwargs: 传递给框架的其他调用参数。

        Returns:
            上游请求字典；思考字段独立保存，不拼入可见正文。

        Raises:
            ValueError: 输入消息与序列化消息数量不一致。
        """
        messages = self._convert_input(input_).to_messages()
        payload = super()._get_request_payload(messages, stop=stop, **kwargs)
        # 将历史模型消息中的思考字段原样带回工具调用后续请求，不拼入正文。
        for message, serialized in zip(messages, payload["messages"], strict=True):
            if isinstance(message, AIMessage):
                reasoning = message.additional_kwargs.get("reasoning_content")
                if isinstance(reasoning, str):
                    serialized["reasoning_content"] = reasoning
        return payload
