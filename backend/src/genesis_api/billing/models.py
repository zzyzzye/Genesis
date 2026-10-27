"""账务凭证独立于业务对象，金额统一以八位小数的人民币元存储。"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    Uuid,
    event,
    func,
)
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Mapped, Mapper, mapped_column

from genesis_api.database.base import Base


class Wallet(Base):
    """用户可用余额和冻结余额；写入前先锁定用户及钱包。"""

    __tablename__ = "billing_wallets"
    __table_args__ = (CheckConstraint("available >= 0 AND frozen >= 0"),)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    available: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal(0))
    frozen: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal(0))


class PricePolicy(Base):
    """管理员审核的单个请求最大费用及输入限制，更新时新建版本。"""

    __tablename__ = "billing_price_policies"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    kind: Mapped[str] = mapped_column(String(20))
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(255), index=True)
    channel: Mapped[str] = mapped_column(String(100), default="", server_default="")
    max_request_amount: Mapped[Decimal] = mapped_column(Numeric(20, 8))
    max_input_bytes: Mapped[int] = mapped_column(Integer)
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=4096)
    quota_per_cny: Mapped[int] = mapped_column(BigInteger)
    # 上限须覆盖该模型所有允许的图片数量、尺寸或视频时长。
    evidence: Mapped[str] = mapped_column(String(1000))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BillingOperation(Base):
    """报价、冻结和结算共用的持久订单，不依赖业务对象的删除生命周期。"""

    __tablename__ = "billing_operations"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    source_id: Mapped[UUID | None] = mapped_column(Uuid, unique=True, nullable=True)
    kind: Mapped[str] = mapped_column(String(20))
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(255))
    mode: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(30), default="quoted", index=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    policy: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    reserved: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal(0))
    charged: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal(0))
    cost: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal(0))
    call_count: Mapped[int] = mapped_column(Integer, default=0)
    finished: Mapped[bool] = mapped_column(Boolean, default=False)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    next_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WalletEntry(Base):
    """只新增的余额凭证；唯一操作键保证网络重试不会重复扣费或充值。"""

    __tablename__ = "billing_entries"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    operation_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("billing_operations.id"), nullable=True
    )
    actor_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    event_key: Mapped[str] = mapped_column(String(200), unique=True)
    kind: Mapped[str] = mapped_column(String(30))
    available_delta: Mapped[Decimal] = mapped_column(Numeric(20, 8))
    frozen_delta: Mapped[Decimal] = mapped_column(Numeric(20, 8))
    reason: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


@event.listens_for(WalletEntry, "before_update")
@event.listens_for(WalletEntry, "before_delete")
def _prevent_entry_mutation(
    _mapper: Mapper[WalletEntry], _connection: Connection, _entry: WalletEntry
) -> None:
    """业务只能追加更正凭证，拒绝通过 ORM 改写或删除已入账流水。"""
    raise ValueError("账务流水不能修改或删除，请追加更正记录")


class UpstreamCharge(Base):
    """一次实际网络发送的归属与结算证据，只保存计费字段白名单。"""

    __tablename__ = "billing_upstream_charges"
    __table_args__ = (UniqueConstraint("channel", "request_id"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    operation_id: Mapped[UUID] = mapped_column(ForeignKey("billing_operations.id"), index=True)
    channel: Mapped[str] = mapped_column(String(80))
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="sending")
    amount: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal(0))
    quota: Mapped[int] = mapped_column(BigInteger, default=0)
    details: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    refund_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
