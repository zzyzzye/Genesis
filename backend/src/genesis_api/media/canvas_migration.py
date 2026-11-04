"""打开旧画布时拆分已完成的视频结果，不重放任务或复制素材文件。"""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.media.models import MediaAsset, MediaProject, ProjectAsset, VideoGeneration
from genesis_api.media.schemas import CanvasDocument, CanvasEdge, CanvasNode, GenerationResult


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
