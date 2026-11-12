"""影音规划、节点改名与生图工具，复用现有画布、归属、生成和计费服务。"""

import asyncio
from typing import Annotated, Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import HTTPException
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool, ToolException, tool
from pydantic import Field, ValidationError
from sqlalchemy import select

from genesis_api.agent.context import require_actor
from genesis_api.agent.tool_inputs import ToolArray, tool_validation_error
from genesis_api.core.config import Settings
from genesis_api.database.session import SessionLocal as SessionLocal
from genesis_api.identity.models import User
from genesis_api.media import catalog, image, service, video
from genesis_api.media.models import ImageGeneration, MediaAsset, ProjectAsset, VideoGeneration
from genesis_api.media.schemas import (
    CanvasDocument,
    CanvasWrite,
    GenerationSettings,
    GenerationSubmit,
)


def build_media_tools(settings: Settings, *, review: bool = True) -> list[BaseTool]:
    """装配画布、模型、参数方案、节点改名与图片任务工具。

    Args:
        settings: 供现有视频服务读取实时目录，不向模型返回连接配置。
        review: 默认接入审阅/自动执行协议；仅确认分派与底层测试关闭包装。

    Returns:
        规划、节点改名与复用现有生图服务的提交、查询工具。
    """

    @tool
    async def get_video_generation_models(model_id: str | None = None) -> dict[str, object]:
        """查询可用视频模型、供应商简介与生成单价，规划前必须调用。

        Args:
            model_id: 指定模型 ID 时仅查询该模型；省略时返回全部可用模型。

        Returns:
            可用模型及 description 简介；简介中的明确限制用于规划，未知参数不能猜测。

        Raises:
            ToolException: 视频服务未配置或实时目录暂时不可用。
        """
        try:
            models = await catalog.generation_models(settings, "video")
        except HTTPException as exc:
            raise ToolException(str(exc.detail)) from None
        return {
            "models": [item for item in models if model_id is None or item["id"] == model_id],
            "description_source": "供应商模型广场，复用目录缓存；缺少 description 表示暂无简介",
            "pricing_notice": "pricing 为当前分组单价；unit 区分每次、每秒或每张，以上游账单为准",
            "references_ready": settings.video_public_base_url.startswith("https://"),
            "duration_semantics": "节点时长为单次生成的秒数，不是成片剪辑时长；支持范围见简介",
            "editing_available": False,
        }

    def read_canvas(project_id: UUID) -> tuple[int, CanvasDocument, dict[UUID, str]]:
        """在独立短事务中复用归属检查读取画布，不持锁等待上游。"""
        try:
            actor_id = require_actor(module="media")
            with SessionLocal() as session:
                project = service.readable_project(session, project_id)
                document = CanvasDocument.model_validate(project.canvas)
                source_kinds = {
                    node.id: service.readable_asset(session, actor_id, node.asset_id).kind
                    if node.asset_id is not None else
                    "image" if node.type in ("image", "image_generation") else node.type
                    for node in document.nodes
                }
                return project.version, document, source_kinds
        except (HTTPException, RuntimeError) as exc:
            raise ToolException(
                str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
            ) from None

    @tool
    async def get_media_canvas(project_id: UUID) -> dict[str, object]:
        """读取当前用户作品的全部已保存节点、参数和参考连线。

        Args:
            project_id: 页面上下文中的作品 ID。

        Returns:
            作品版本、全部节点和连线；不包含浏览器尚未保存的编辑。
        """
        version, document, source_kinds = await asyncio.to_thread(read_canvas, project_id)
        references = {
            node.id: image.reference_nodes(document, node.id) for node in document.nodes
        }
        return {
            "project_id": str(project_id),
            "version": version,
            "nodes": [{
                **node.model_dump(mode="json"),
                "reference_node_ids": [str(source.id) for source in references[node.id]],
                "image_reference_node_ids": [
                    str(source.id) for source in references[node.id]
                    if source_kinds[source.id] == "image"
                ],
                "image_mention_token": f"@[图片](ref:{node.id})"
                if source_kinds[node.id] == "image" else None,
                "text_reference_node_ids": [
                    str(source.id) for source in references[node.id] if source.type == "text"
                ],
                "text_mention_token": f"@[文字](ref:{node.id})"
                if node.type == "text" else None,
            } for node in document.nodes],
            "edges": [edge.model_dump(mode="json") for edge in document.edges],
            "image_generation_with_references_node_ids": [
                str(node.id) for node in document.nodes if node.type == "image_generation"
                and any(source_kinds[source.id] == "image" for source in references[node.id])
            ],
            "source": "已保存画布；浏览器未保存修改可能不同",
        }

    @tool(response_format="content_and_artifact")
    async def rename_node(
        project_id: UUID,
        node_id: UUID,
        name: str,
        expected_version: Annotated[int, Field(ge=0)],
    ) -> tuple[dict[str, object], dict[str, object]]:
        """直接改名并保存当前用户画布中的一个节点，无需另点应用按钮。

        Args:
            project_id: 当前作品 ID，先用 get_media_canvas 读取真实画布。
            node_id: 要改名的真实节点 ID，支持所有节点类型。
            name: 新名称，去掉首尾空白后须为 1–120 字符。
            expected_version: get_media_canvas 返回的最新版本，冲突时重读。

        Returns:
            已保存的原名、新名与版本，以及用于前端同步的资源回执。
            同名调用不会再次增加版本；只修改标题，不修改正文、位置或素材。

        Raises:
            ToolException: 身份无效、节点不可访问、名称无效或画布版本过期。
        """

        def rename() -> tuple[dict[str, object], dict[str, object]]:
            try:
                actor_id = require_actor(module="media")
                with SessionLocal() as session:
                    result = service.rename_node(
                        session, actor_id, project_id, node_id, name, expected_version
                    )
                    session.commit()
                receipt_id = uuid5(
                    NAMESPACE_URL,
                    f"genesis:rename:{project_id}:{node_id}:{expected_version}:{result['name']}",
                )
                return result, {
                    "resource": {
                        "module": "media",
                        "kind": "canvas_node_rename",
                        "id": str(receipt_id),
                        "scope_id": str(project_id),
                        "parent_id": str(node_id),
                    }
                }
            except ValidationError:
                raise ToolException("节点名称去掉首尾空白后须为 1–120 字符") from None
            except (HTTPException, RuntimeError) as exc:
                raise ToolException(
                    str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
                ) from None

        return await asyncio.to_thread(rename)

    @tool
    async def get_image_generation_models(query: str = "") -> dict[str, object]:
        """查询真实图片模型 ID，可按名称关键词筛选，不查询视频目录。

        Args:
            query: 名称片段；空字符串返回全部可用图片模型。

        Returns:
            真实模型、图生图说明与上游 description 简介；未说明的尺寸不能猜测。
        """
        try:
            rows = await catalog.generation_models(settings, "image")
        except HTTPException as exc:
            raise ToolException(str(exc.detail)) from None
        needle = "".join(c for c in query.casefold() if c.isalnum())
        rows = [
            row
            for row in rows
            if needle in "".join(c for c in str(row["id"]).casefold() if c.isalnum())
        ]
        return {
            "models": rows,
            "description_source": "供应商模型广场，复用目录缓存；缺少 description 表示暂无简介",
            "pricing_notice": "pricing 为当前分组单价；unit 区分每次、每秒或每张，以上游账单为准",
            "size_support": (
                "尺寸限制以 description 明确说明为依据；"
                "未声明时沿用节点尺寸设置协议，不保证生成成功"
            ),
        }

    @tool
    async def configure_image_nodes(
        project_id: UUID,
        model_id: str,
        image_ratio: str,
        image_resolution: str,
        node_ids: ToolArray[UUID] | None = None,
    ) -> dict[str, object]:
        """校验并准备批量生图参数方案，不启动生成，应用后由现有画布接口保存。

        Args:
            project_id: 当前作品 ID，须属于当前用户。
            model_id: 图片目录查询返回的精确模型 ID，不能使用猜测的别名。
            image_ratio: 图片比例，例如 16:9。
            image_resolution: 清晰度，例如 1K、2K、4K。
            node_ids: 要修改的生图节点 ID；省略表示全部生图节点，每批最多8个。

        Returns:
            可直接输出到 canvas-plan 的参数方案，带原参数防止覆盖新编辑。

        Raises:
            ToolException: 模型不可用、节点越权或缺失、类型错误、参数无效。
        """
        try:
            with SessionLocal() as session:
                service.project_for(session, require_actor(module="media"), project_id)
        except (HTTPException, RuntimeError) as exc:
            raise ToolException(
                str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
            ) from None
        version, document, _image_targets = await asyncio.to_thread(read_canvas, project_id)
        try:
            GenerationSettings.model_validate(
                {
                    "model": model_id,
                    "image_ratio": image_ratio,
                    "image_resolution": image_resolution,
                }
            )
        except ValidationError:
            raise ToolException("图片比例或清晰度无效，请使用节点支持的参数") from None
        if not image_ratio or not image_resolution:
            raise ToolException("请明确指定图片比例和清晰度")
        try:
            rows = await image.available_models(settings)
        except HTTPException as exc:
            raise ToolException(str(exc.detail)) from None
        model = next((row for row in rows if row["id"] == model_id), None)
        if model is None:
            raise ToolException("图片模型当前不可用，请查询真实目录后重试")
        targets = [
            node
            for node in document.nodes
            if (node.id in node_ids if node_ids is not None else node.type == "image_generation")
        ]
        if node_ids is not None and (
            not node_ids or len(set(node_ids)) != len(node_ids) or len(targets) != len(node_ids)
        ):
            raise ToolException("目标节点缺失或重复，请重新读取画布")
        if not targets or len(targets) > 8:
            raise ToolException("请指定1–8个生图节点；更多节点请分批设置")
        if any(node.type != "image_generation" for node in targets):
            raise ToolException("目标中包含非生图节点，未修改任何节点")
        return {
            "title": f"统一设置 {len(targets)} 个生图节点",
            "project_id": str(project_id),
            "version": version,
            "operations": [
                {
                    "action": "update_node",
                    "node_id": str(node.id),
                    "generation": {
                        "model": model_id,
                        "image_ratio": image_ratio,
                        "image_resolution": image_resolution,
                    },
                    "expected_generation": {
                        key: node.generation.model_dump()[key]
                        for key in (
                            "model",
                            "mode",
                            "image_ratio",
                            "image_resolution",
                            "image_size",
                        )
                    },
                }
                for node in targets
            ],
        }

    @tool(response_format="content_and_artifact")
    async def submit_image_generation(
        project_id: UUID,
        node_id: UUID,
        expected_version: int,
        config: RunnableConfig,
        acknowledge_unknown: bool = False,
    ) -> tuple[dict[str, object], dict[str, object]]:
        """提交用户明确要求生成的一个生图节点，使用已保存参数并可能产生实际费用。

        Args:
            project_id: 当前作品 ID，先读取 get_media_canvas 确认归属与目标。
            node_id: 真实生图节点 ID；“第一张”按节点名称和画布内容确定，不猜 ID。
            expected_version: get_media_canvas 返回的最新版本；过期时重读，不强行覆盖。
            config: 运行时注入的任务标识，用于生成请求幂等。
            acknowledge_unknown: 仅用户明确要求重新生成未知任务时启用，默认复用原任务。

        Returns:
            真实任务 ID、状态及是否复用已有任务；画布自动展示结果节点和加载状态。
            已提交不等于图片已完成，不要等待或循环查询。

        Raises:
            ToolException: 无有效执行上下文、参数或参考未就绪、模型不可用、余额不足。
        """
        try:
            actor_id = require_actor(module="media")
            run_id = UUID(str(config.get("configurable", {}).get("genesis_run_id", "")))
            # 每轮、每节点只有一个意图，框架重放或模型重复调用不会重复消费。
            request_id = uuid5(
                NAMESPACE_URL, f"genesis:image:{actor_id}:{run_id}:{project_id}:{node_id}"
            )
            with SessionLocal() as session:
                user = session.get(User, actor_id)
                if user is None:
                    raise ToolException("账户不存在")
                task, created = await image.admit_task(
                    session,
                    user,
                    project_id,
                    GenerationSubmit(request_id=request_id, node_id=node_id,
                                     acknowledge_unknown=acknowledge_unknown),
                    settings,
                    expected_version=expected_version,
                    reuse_active=True,
                )
                result = {
                    "project_id": str(project_id),
                    **image.task_data(task),
                    "reused": not created,
                }
                resource = {
                    "module": "media",
                    "kind": "image_generation",
                    "id": str(task.id),
                    "scope_id": str(project_id),
                    "parent_id": str(task.node_id),
                }
                if created:
                    image.start_agent_task(task.id, settings)
            return result, {"resource": resource}
        except HTTPException as exc:
            raise ToolException(str(exc.detail)) from None
        except (RuntimeError, ValueError):
            raise ToolException("缺少有效的影音执行上下文，请重新发送生成请求") from None

    @tool
    async def get_image_generation_task(project_id: UUID, task_id: UUID) -> dict[str, object]:
        """查询一个已提交图片任务，不重新生成、不重复收费。

        Args:
            project_id: 任务所属的当前作品 ID。
            task_id: 提交工具返回的真实任务 ID。

        Returns:
            当前状态、错误及完成后的素材 ID；处理中应告知用户等待画布更新。
        """

        def read_task() -> dict[str, object]:
            try:
                actor_id = require_actor(module="media")
                with SessionLocal() as session:
                    service.project_for(session, actor_id, project_id)
                    task = session.get(ImageGeneration, task_id)
                    if task is None or task.owner_id != actor_id or task.project_id != project_id:
                        raise ToolException("图片任务不存在")
                    return image.task_data(task)
            except (HTTPException, RuntimeError) as exc:
                raise ToolException(
                    str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
                ) from None

        return await asyncio.to_thread(read_task)

    @tool(response_format="content_and_artifact")
    async def edit_media_canvas(
        project_id: UUID, expected_version: int, document: CanvasDocument,
    ) -> tuple[dict[str, object], dict[str, object]]:
        """按用户要求直接保存完整画布，支持节点新建/删除/副本/编组/取消编组/排版/移动缩放/参数及引用编辑。

        Args:
            project_id: 当前作品，先调用 get_media_canvas。
            expected_version: 刚读取的版本，过期必须重读，不能强行覆盖。
            document: 完整目标画布，保留无关节点、视口和设置。新节点/线使用新 UUID。
                副本重映射内部线与图片标签，保留外部上游、不复制到原下游的线。
                分组使用 member_ids，取消编组只移除组框；删除成员须维护分组和连线。
                断开引用只删线，保留素材；图片实际使用还须在 text 写入 @[图片](ref:节点UUID)。
                上传/已有素材使用 image、video_asset、audio 节点，asset_id 必须已关联作品。
                排版按引用从左到右布置，生成结果放右侧；移动分组须同步移动成员。

        Returns:
            已保存版本、完整文档与前端同步回执。没有启动付费生成。
        """
        def write() -> tuple[dict[str, object], dict[str, object]]:
            try:
                actor = require_actor(module="media")
                with SessionLocal() as session:
                    project = service.project_for(session, actor, project_id)
                    if CanvasDocument.model_validate(project.canvas) == document:
                        result = {"version": project.version, "document": project.canvas}
                    else:
                        result = service.save_canvas(
                            session, actor, project_id,
                            CanvasWrite(version=expected_version, document=document),
                        )
                receipt = uuid5(NAMESPACE_URL, f"canvas:{project_id}:{result['version']}")
                return result, {"resource": {
                    "module": "media", "kind": "canvas_edit", "id": str(receipt),
                    "scope_id": str(project_id), "parent_id": str(project_id),
                }}
            except (HTTPException, RuntimeError) as exc:
                raise ToolException(
                    str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
                ) from None
        return await asyncio.to_thread(write)

    @tool
    async def get_media_assets(project_id: UUID, page: int = 1) -> dict[str, object]:
        """读取当前用户作品及账户库素材的真实 ID、名称与类型，每页50项，不返回文件授权地址。"""
        def read() -> dict[str, object]:
            actor = require_actor(module="media")
            with SessionLocal() as session:
                service.project_for(session, actor, project_id)
                linked = set(session.scalars(select(ProjectAsset.asset_id).where(
                    ProjectAsset.project_id == project_id
                )))
                rows = session.scalars(select(MediaAsset).where(
                    MediaAsset.owner_id == actor,
                    (MediaAsset.id.in_(linked)) | MediaAsset.in_library,
                ).order_by(MediaAsset.id).offset((max(1, page) - 1) * 50).limit(51)).all()
                return {"items": [{"id": str(row.id), "name": row.name, "kind": row.kind,
                                   "linked": row.id in linked} for row in rows[:50]],
                        "has_more": len(rows) > 50}
        try:
            return await asyncio.to_thread(read)
        except (HTTPException, RuntimeError) as exc:
            raise ToolException(
                str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
            ) from None

    @tool
    async def reference_media_asset(project_id: UUID, asset_id: UUID) -> dict[str, object]:
        """关联本人账户素材，随后用 edit_media_canvas 创建素材节点及连线。"""
        def attach() -> dict[str, object]:
            actor = require_actor(module="media")
            with SessionLocal() as session:
                service.project_for(session, actor, project_id)
                asset = service.asset_for(session, actor, asset_id)
                linked = session.get(ProjectAsset, (project_id, asset_id))
                if not asset.in_library and linked is None:
                    raise ToolException("素材不在账户素材库中")
                if session.get(ProjectAsset, (project_id, asset_id)) is None:
                    session.add(ProjectAsset(project_id=project_id, asset_id=asset_id))
                    session.commit()
                return {"id": str(asset.id), "name": asset.name, "kind": asset.kind}
        try:
            return await asyncio.to_thread(attach)
        except (HTTPException, RuntimeError) as exc:
            raise ToolException(
                str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
            ) from None

    @tool(response_format="content_and_artifact")
    async def submit_video_generation(
        project_id: UUID, node_id: UUID, expected_version: int, config: RunnableConfig,
        acknowledge_unknown: bool = False,
    ) -> tuple[dict[str, object], dict[str, object]]:
        """提交已保存的视频节点，可能收费；同轮同节点及已有运行任务复用，不重复生成。"""
        try:
            actor = require_actor(module="media")
            run_id = UUID(str(config.get("configurable", {}).get("genesis_run_id", "")))
            request_id = uuid5(
                NAMESPACE_URL, f"genesis:video:{actor}:{run_id}:{project_id}:{node_id}"
            )
            with SessionLocal() as session:
                user = session.get(User, actor)
                if user is None:
                    raise ToolException("账户不存在")
                task, payload = await video.admit_task(
                    session, user, project_id,
                    video.VideoSubmit(request_id=request_id, node_id=node_id,
                                      acknowledge_unknown=acknowledge_unknown), settings,
                    expected_version=expected_version, reuse_active=True,
                )
                result = {"project_id": str(project_id), **video.task_data(task),
                          "reused": payload is None}
                resource = {"module": "media", "kind": "video_generation", "id": str(task.id),
                            "scope_id": str(project_id), "parent_id": str(node_id)}
                if payload is not None:
                    video.start_agent_task(task.id, payload, settings)
                return result, {"resource": resource}
        except HTTPException as exc:
            raise ToolException(str(exc.detail)) from None
        except (RuntimeError, ValueError):
            raise ToolException("缺少有效的影音执行上下文，请重新发送生成请求") from None

    @tool
    async def get_video_generation_task(project_id: UUID, task_id: UUID) -> dict[str, object]:
        """查询已提交视频任务的当前状态与结果素材，不重新生成。"""
        def read() -> dict[str, object]:
            actor = require_actor(module="media")
            with SessionLocal() as session:
                service.project_for(session, actor, project_id)
                task = session.get(VideoGeneration, task_id)
                if task is None or task.owner_id != actor or task.project_id != project_id:
                    raise ToolException("视频任务不存在")
                return video.task_data(task)
        try:
            return await asyncio.to_thread(read)
        except (HTTPException, RuntimeError) as exc:
            raise ToolException(
                str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
            ) from None

    @tool(response_format="content_and_artifact")
    async def retry_generation_save(
        project_id: UUID, task_id: UUID, kind: Literal["image", "video"],
    ) -> tuple[dict[str, object], dict[str, object]]:
        """重试保存已有图片或视频结果，不发起新的付费生成。

        Args:
            project_id: 当前作品 ID。
            task_id: 查询工具返回的真实任务 ID。
            kind: 图片 image 或视频 video。
        """
        from fastapi import BackgroundTasks

        from genesis_api.api.routes.media_image import retry_image_save
        from genesis_api.api.routes.media_video import retry_video_download

        actor = require_actor(module="media")
        background = BackgroundTasks()
        try:
            with SessionLocal() as session:
                service.project_for(session, actor, project_id)
                user = session.get(User, actor)
                task = (session.get(ImageGeneration, task_id) if kind == "image"
                        else session.get(VideoGeneration, task_id))
                if (user is None or task is None or task.owner_id != actor
                        or task.project_id != project_id):
                    raise ToolException("生成任务不存在")
                if task.status in ("downloading", "completed"):
                    result = (image.task_data(task) if isinstance(task, ImageGeneration)
                              else video.task_data(task))
                elif kind == "image":
                    result = retry_image_save(project_id, task_id, user, session, background)
                else:
                    result = retry_video_download(project_id, task_id, user, session)
                node_id = str(task.node_id)
            await background()
            return result, {"resource": {
                "module": "media", "kind": f"{kind}_generation", "id": str(task_id),
                "scope_id": str(project_id), "parent_id": node_id,
            }}
        except HTTPException as exc:
            raise ToolException(str(exc.detail)) from None

    result = [
        get_video_generation_models,
        get_media_canvas,
        get_image_generation_models,
        configure_image_nodes,
        submit_image_generation,
        get_image_generation_task,
        rename_node,
        edit_media_canvas, get_media_assets, reference_media_asset,
        submit_video_generation, get_video_generation_task, retry_generation_save,
    ]
    for entry in result:
        entry.handle_tool_error = True
        entry.handle_validation_error = tool_validation_error
    if review:
        from genesis_api.media.agent.actions import MEDIA_ACTIONS, reviewed_tool

        return [reviewed_tool(entry, settings) if entry.name in MEDIA_ACTIONS else entry
                for entry in result]
    return result
