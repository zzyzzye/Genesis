"""用户澄清工具与公共协作规则，复用框架的工具结束和会话恢复能力。"""

import json
from uuid import uuid4

from langchain_core.tools import tool
from pydantic import BaseModel, ConfigDict, Field, model_validator

COLLABORATION_PROMPT = """
协作规则：始终使用自然、简洁的简体中文。
先检查当前对话、可信页面上下文和可用只读工具，不要重复询问已知信息。
信息足够就直接推进；可逆的小细节采用合理默认值并简要说明，不为每个细节追问。
缺少会改变目标、对象、范围、发布意图或执行结果的关键信息时，先调用 ask_user_question，
不要擅自猜测，也不要先生成依赖该答案的写操作提议。自动模式同样不能替用户决定未知意图。
对过宽的任务，先用一句话总结目标，再将最关键的方向整理成 2–3 个有实质区别的选项，
说明各自影响；能判断时只推荐一个，不能判断时不强推。不要把所有后续细节一次性丢给用户。
一次集中询问 1–3 个关键问题，每题提供 2–3 个互斥选项；无法合理列出选项时使用空列表，
让用户自由回答。界面始终支持自定义回答，不要添加“其他”选项，不默认替用户选择或提交。
提问只使用 ask_user_question 工具，不自行输出问题 JSON 或代码块；同一批次不要混用提问与业务工具。
该工具结束本轮回复，等待用户明确回答后再沿用同一会话继续，不把沉默或超时当作答案。
澄清回答只补充需求，不替代业务写操作的独立确认；用户更改方向时以最新明确指令为准。
"""


class QuestionOption(BaseModel):
    """一个可选择的方向及其实际影响。"""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    label: str = Field(min_length=1, max_length=60)
    description: str = Field(min_length=1, max_length=240)
    recommended: bool = False


class UserQuestion(BaseModel):
    """需要用户补充的一个关键问题。"""

    # 部分模型会附带标题、编号或多选提示；界面仍按单选契约展示，不采用未知提示。
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    question: str = Field(min_length=1, max_length=500)
    options: list[QuestionOption] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def validate_options(self) -> "UserQuestion":
        """拒绝无意义的单选项、重复方向与多个推荐。"""
        if len(self.options) == 1:
            raise ValueError("请提供两个或三个选项，或使用空列表自由提问")
        if len({option.label for option in self.options}) != len(self.options):
            raise ValueError("选项名称不能重复")
        if sum(option.recommended for option in self.options) > 1:
            raise ValueError("每个问题最多推荐一个方向")
        return self


class QuestionRequest(BaseModel):
    """集中呈现一次澄清所需的问题，避免连续打断用户。"""

    questions: list[UserQuestion] = Field(min_length=1, max_length=3)


@tool(args_schema=QuestionRequest, return_direct=True)
def ask_user_question(questions: list[UserQuestion]) -> str:
    """缺少关键信息或任务过宽时，向用户展示选择卡片并结束本轮等待回答。

    Args:
        questions: 一到三个关键问题，每题包含可选方向或空选项列表。

    Returns:
        可随既有回复流持久化的用户问题块；不会执行任何业务写入。
    """
    request = QuestionRequest(questions=questions)
    payload = {"id": str(uuid4()), **request.model_dump()}
    return "\n```user-question\n" + json.dumps(payload, ensure_ascii=False) + "\n```\n"
