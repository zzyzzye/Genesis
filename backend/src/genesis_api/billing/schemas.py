"""账务输入只接受十进制金额和服务端可核验的资源标识。"""

from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


class TokenPriceTier(BaseModel):
    """每百万 Token 的精确十进制单价，缺失价格不以零代替。"""

    name: str
    condition: str | None = None
    input: str
    output: str
    cache_read: str | None = None
    cache_write: str | None = None
    cache_write_1h: str | None = None


class ModelPricePreview(BaseModel):
    """仅用于核价展示，不作为已审核冻结上限或结算凭证。"""

    status: Literal["available", "unavailable", "free"]
    currency: Literal["CNY", "USD"] = "CNY"
    unit: Literal["1M tokens"] = "1M tokens"
    group: str | None = None
    group_ratio: str | None = None
    tiers: list[TokenPriceTier] = Field(default_factory=list)
    note: str = "价格仅供核对，实际费用以上游账单为准。"
    updated_at: str | None = None


class QuoteRequest(BaseModel):
    """文本报价绑定供应商和模型，图片视频报价绑定已保存的节点。"""

    kind: Literal["agent", "image", "video"]
    provider: Literal["openai", "grok", "gemini", "claude", "mimo"] = "openai"
    model: str = Field(default="", max_length=255)
    project_id: UUID | None = None
    node_id: UUID | None = None


class CreditRequest(BaseModel):
    """充值和更正均要求稳定操作标识及管理员备注。"""

    model_config = ConfigDict(str_strip_whitespace=True)

    request_id: UUID
    user_id: UUID
    amount: str = Field(pattern=r"^-?(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$")
    reason: str = Field(min_length=1, max_length=500)


class PolicyRequest(BaseModel):
    """审核的最大费用须包含缓存、工具附加费和全部允许生成参数。"""

    request_id: UUID = Field(default_factory=uuid4)

    kind: Literal["agent", "image", "video"]
    provider: str = Field(min_length=1, max_length=20)
    model: str = Field(min_length=1, max_length=255)
    max_request_amount: str = Field(pattern=r"^(?:0|[1-9]\d{0,6})(?:\.\d{1,8})?$")
    max_input_bytes: int = Field(ge=1, le=10_000_000)
    max_output_tokens: int = Field(default=4096, ge=1, le=4096)
    quota_per_cny: int = Field(ge=1, le=1_000_000_000)
    evidence: str = Field(min_length=1, max_length=1000)
    verified: Literal[True]
