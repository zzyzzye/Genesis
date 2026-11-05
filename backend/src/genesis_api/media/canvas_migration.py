"""打开旧画布时恢复图片参考和独立视频成品，不重放任务或复制素材文件。"""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.media.models import MediaAsset, MediaProject, ProjectAsset, VideoGeneration
from genesis_api.media.schemas import CanvasDocument, CanvasEdge, CanvasNode, GenerationResult


def restore_legacy_video_image_references(
    session: Session, project: MediaProject, document: CanvasDocument
) -> CanvasDocument:
    """将旧上传入口误放进视频预览的图片恢复为连入参考。

    只处理本作品已关联且归属正确的图片，不把视频成品倒接为参考。
    保留提示词、结果连线和视口；已连入同一图片时复用，容量不足时不丢原图。
    调用方持有作品锁，并与画布版本一起提交。
    """
    asset_ids = {node.asset_id for node in document.nodes if node.type == "video" and node.asset_id}
    if not asset_ids:
        return document
    assets = {
        asset.id: asset
        for asset in session.scalars(
            select(MediaAsset)
            .join(ProjectAsset, ProjectAsset.asset_id == MediaAsset.id)
            .where(
                MediaAsset.id.in_(asset_ids),
                MediaAsset.owner_id == project.owner_id,
                MediaAsset.kind == "image",
                ProjectAsset.project_id == project.id,
            )
        )
    }
    nodes = list(document.nodes)
    edges = list(document.edges)
    changed = False
    for index, target in enumerate(document.nodes):
        asset = assets.get(target.asset_id) if target.type == "video" and target.asset_id else None
        if asset is None:
            continue
        incoming = {edge.source for edge in edges if edge.target == target.id}
        reference = next(
            (
                node
                for node in nodes
                if node.id != target.id and node.id in incoming and node.asset_id == asset.id
            ),
            None,
        )
        if reference is None:
            if len(nodes) >= 1000 or len(edges) >= 2000:
                continue
            x = max(-1000000, target.x - 480)
            y = target.y
            # 新参考向下避让，不移动已有布局。
            while overlaps := [
                node
                for node in nodes
                if x < node.x + node.width + 32
                and x + 392 > node.x
                and y < node.y + node.height + 64
                and y + 344 > node.y
            ]:
                next_y = max(node.y + node.height + 96 for node in overlaps)
                if next_y > 999720:
                    break
                y = next_y
            if overlaps:
                continue
            reference = CanvasNode(
                id=uuid4(),
                type="image",
                name=asset.name[:120],
                asset_id=asset.id,
                x=x,
                y=y,
                width=360,
                height=280,
            )
            nodes.append(reference)
            edges.append(CanvasEdge(id=uuid4(), source=reference.id, target=target.id))
        nodes[index] = target.model_copy(
            update={
                "asset_id": None,
                "generation": target.generation.model_copy(
                    update={
                        "mode": "first_last"
                        if target.generation.mode == "first_last"
                        else "reference",
                    }
                ),
            }
        )
        changed = True
    return document.model_copy(update={"nodes": nodes, "edges": edges}) if changed else document


def detach_legacy_video_results(
    session: Session, project: MediaProject, document: CanvasDocument
) -> CanvasDocument:
    """只迁移有完成任务证据的内嵌视频，保留草稿、视口和既有引用关系。

    Args:
        session: 调用方持有作品行锁的会话，提交由调用方负责。
        project: 已校验归属的作品。
        document: 已保存画布；用户上传的预览和未完成任务保持原样。

    Returns:
        幂等拆分后的画布；无可迁移结果或容量不足时保留原节点。
    """
    sources = {node.id: node for node in document.nodes if node.type == "video" and node.asset_id}
    if not sources:
        return document
    completed = session.execute(
        select(VideoGeneration, MediaAsset)
        .join(MediaAsset, MediaAsset.id == VideoGeneration.asset_id)
        .join(ProjectAsset, ProjectAsset.asset_id == MediaAsset.id)
        .where(
            VideoGeneration.project_id == project.id,
            VideoGeneration.owner_id == project.owner_id,
            VideoGeneration.node_id.in_(sources),
            VideoGeneration.status == "completed",
            MediaAsset.owner_id == project.owner_id,
            MediaAsset.kind == "video",
            ProjectAsset.project_id == project.id,
        )
        .order_by(VideoGeneration.created_at, VideoGeneration.id)
    ).all()
    nodes = list(document.nodes)
    edges = list(document.edges)
    migrated = set()
    for task, asset in completed:
        source = sources[task.node_id]
        if source.id in migrated or source.asset_id != asset.id:
            continue
        result = next(
            (
                node
                for node in nodes
                if node.type == "video_asset"
                and node.asset_id == asset.id
                and (
                    (node.video_result and node.video_result.task_id == task.id)
                    or any(edge.source == source.id and edge.target == node.id for edge in edges)
                )
            ),
            None,
        )
        linked = result is not None and any(
            edge.source == source.id and edge.target == result.id for edge in edges
        )
        if (result is None and len(nodes) >= 1000) or (not linked and len(edges) >= 2000):
            continue
        if result is None:
            w, h = (int(part) for part in source.generation.ratio.split(":"))
            height = max(80, min(4000, 360 * h / w))
            x = min(999640, source.x + source.width + 160)
            y = max(-1000000, min(1000000 - height, source.y))
            # 将新结果放到现有内容下方，避免旧自定义布局被新节点覆盖。
            overlaps = [
                node
                for node in nodes
                if x < node.x + node.width + 32
                and x + 392 > node.x
                and y < node.y + node.height + 64
                and y + height + 64 > node.y
            ]
            while overlaps and y < 1000000 - height:
                y = min(1000000 - height, max(node.y + node.height + 96 for node in overlaps))
                overlaps = [
                    node
                    for node in nodes
                    if x < node.x + node.width + 32
                    and x + 392 > node.x
                    and y < node.y + node.height + 64
                    and y + height + 64 > node.y
                ]
            result = CanvasNode(
                id=uuid4(),
                type="video_asset",
                asset_id=asset.id,
                name=asset.name[:120],
                x=x,
                y=y,
                width=360,
                height=height,
                video_result=GenerationResult(task_id=task.id, index=0, status="completed"),
            )
            nodes.append(result)
        targets = {
            edge.target for edge in edges if edge.source == source.id and edge.target != result.id
        }
        nodes = [
            node.model_copy(update={"asset_id": None, "video_result": None})
            if node.id == source.id
            else node.model_copy(
                update={"text": node.text.replace(f"](ref:{source.id})", f"](ref:{result.id})")}
            )
            if node.id in targets
            else node
            for node in nodes
        ]
        edges = [
            edge.model_copy(update={"source": result.id})
            if edge.source == source.id and edge.target in targets
            else edge
            for edge in edges
        ]
        if not linked:
            edges.append(CanvasEdge(id=uuid4(), source=source.id, target=result.id))
        migrated.add(source.id)
    return document.model_copy(update={"nodes": nodes, "edges": edges}) if migrated else document
