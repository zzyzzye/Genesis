"""站长跨业务只读视图，仅查询管理所需元数据。"""

from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import String, case, cast, func, literal, or_, select, union_all

from genesis_api.ai.models import AiChatRun
from genesis_api.api.dependencies import OwnerDependency, SessionDependency
from genesis_api.billing.models import BillingOperation, Wallet
from genesis_api.blog.models import BlogPost
from genesis_api.identity.models import User
from genesis_api.media.models import ImageGeneration, MediaAsset, MediaProject, VideoGeneration

router = APIRouter(prefix="/admin", tags=["全站管理"])


def task_query() -> Any:
    """合并任务元数据，不加载正文、提示词、快照或原始错误。"""
    chat = select(
        AiChatRun.id.label("id"),
        AiChatRun.user_id.label("user_id"),
        case(
            (AiChatRun.surface.in_(["studio", "blog"]), "blog"),
            (AiChatRun.surface == "media", "media"),
            else_="toolbox",
        ).label("business"),
        case((AiChatRun.surface == "toolbox", "svg"), else_="agent").label("kind"),
        cast(AiChatRun.status, String).label("status"),
        AiChatRun.created_at.label("created_at"),
        AiChatRun.completed_at.label("completed_at"),
    )
    sources = [chat]
    media_models: list[tuple[type[ImageGeneration] | type[VideoGeneration], str]] = [
        (ImageGeneration, "image"),
        (VideoGeneration, "video"),
    ]
    for model, kind in media_models:
        sources.append(
            select(
                model.id,
                model.owner_id,
                literal("media"),
                literal(kind),
                model.status,
                model.created_at,
                literal(None),
            )
        )
    return union_all(*sources).subquery()


@router.get("/overview")
def overview(_: OwnerDependency, session: SessionDependency, response: Response) -> Any:
    """返回全站数量及近二十四小时任务状态，聚合不含私人内容。"""
    response.headers["Cache-Control"] = "no-store"
    tasks = task_query()
    since = datetime.now(UTC) - timedelta(hours=24)
    statuses = {
        str(key): int(value)
        for key, value in session.execute(
            select(tasks.c.status, func.count())
            .where(tasks.c.created_at >= since)
            .group_by(tasks.c.status)
        ).all()
    }
    counts = {}
    for name, model in [
        ("users", User),
        ("posts", BlogPost),
        ("projects", MediaProject),
        ("assets", MediaAsset),
    ]:
        counts[name] = session.scalar(select(func.count()).select_from(model)) or 0
    return {
        **counts,
        "tasks_24h": sum(statuses.values()),
        "statuses": statuses,
        "review_orders": session.scalar(
            select(func.count())
            .select_from(BillingOperation)
            .where(BillingOperation.status == "review")
        )
        or 0,
        "businesses": [
            dict(row)
            for row in session.execute(
                select(tasks.c.business, func.count().label("tasks")).group_by(tasks.c.business)
            ).mappings()
        ],
    }


@router.get("/users")
def users(
    _: OwnerDependency,
    session: SessionDependency,
    response: Response,
    q: str = Query("", max_length=100),
    page: int = Query(1, ge=1, le=100000),
) -> Any:
    """分页查询公开账号字段与钱包余额，不查询凭据、邮箱或登录记录。"""
    response.headers["Cache-Control"] = "no-store"
    condition = or_(
        User.handle.icontains(q, autoescape=True), User.display_name.icontains(q, autoescape=True)
    )
    total = session.scalar(select(func.count()).select_from(User).where(condition)) or 0
    page = min(page, max(1, (total + 19) // 20))
    rows = session.execute(
        select(
            User.id,
            User.handle,
            User.display_name,
            User.role,
            User.created_at,
            Wallet.available,
        )
        .outerjoin(Wallet, Wallet.user_id == User.id)
        .where(condition)
        .order_by(User.created_at.desc(), User.id)
        .offset((page - 1) * 20)
        .limit(20)
    ).mappings()
    return {
        "items": [
            {
                **dict(row),
                "available": str(row["available"]) if row["available"] is not None else None,
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": 20,
    }


@router.get("/tasks")
def tasks(
    _: OwnerDependency,
    session: SessionDependency,
    response: Response,
    business: Literal["", "blog", "media", "toolbox"] = "",
    status: str = Query("", max_length=30),
    user_id: UUID | None = None,
    hours: int | None = Query(None, ge=24, le=24),
    page: int = Query(1, ge=1, le=100000),
) -> Any:
    """分页筛选跨业务任务；媒体旧任务没有完成时间时不推测耗时。"""
    response.headers["Cache-Control"] = "no-store"
    table = task_query()
    query = select(table)
    if business:
        query = query.where(table.c.business == business)
    if status:
        query = query.where(table.c.status == status)
    if user_id:
        query = query.where(table.c.user_id == user_id)
    if hours:
        query = query.where(table.c.created_at >= datetime.now(UTC) - timedelta(hours=hours))
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    page = min(page, max(1, (total + 19) // 20))
    rows = session.execute(
        query.order_by(table.c.created_at.desc(), table.c.id).offset((page - 1) * 20).limit(20)
    ).mappings()
    return {"items": [dict(row) for row in rows], "total": total, "page": page, "page_size": 20}


@router.get("/monitoring")
async def monitoring(
    _: OwnerDependency,
    response: Response,
    window: Literal["1h", "24h", "7d"] = "1h",
) -> Any:
    """仅代理固定监控查询，不接收目标地址或任意 PromQL。"""
    from genesis_api.monitoring import snapshot

    response.headers["Cache-Control"] = "no-store"
    try:
        return await snapshot(window)
    except (ValueError, OSError) as exc:
        raise HTTPException(503, "监控暂不可用，请检查监控采集服务") from exc
