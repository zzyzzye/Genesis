"""影音请求结构与数值边界；素材归属、连线和分组关系由路由结合数据库校验。"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProjectWrite(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)


class GenerationSettings(BaseModel):
    """随画布保存的生成参数草稿，不表示已经提交模型生成任务。"""

    model: str = Field(default="", max_length=200)
    mode: Literal["text", "reference", "first_last"] = "text"
    ratio: Literal["16:9", "9:16", "1:1", "4:3", "3:4"] = "16:9"
    resolution: Literal["480P", "720P", "1080P"] = "720P"
    count: Literal[1, 2, 4] = 1
    sound: bool = True


class CanvasNode(BaseModel):
    """画布节点结构；asset_id 只引用素材，member_ids 仅适用于分组。"""

    id: UUID
    type: Literal["asset", "note", "text", "shape", "group", "video", "image", "audio"]
    asset_id: UUID | None = None
    member_ids: list[UUID] = Field(default_factory=list, max_length=1000)
    name: str = Field(default="", max_length=120)
    duration_seconds: int = Field(default=5, strict=True, ge=1, le=600)
    generation: GenerationSettings = Field(default_factory=GenerationSettings)
    text: str = Field(default="", max_length=20000)
    x: float = Field(allow_inf_nan=False, ge=-1000000, le=1000000)
    y: float = Field(allow_inf_nan=False, ge=-1000000, le=1000000)
    width: float = Field(ge=100, le=4000)
    height: float = Field(ge=80, le=4000)


class CanvasEdge(BaseModel):
    id: UUID
    source: UUID
    target: UUID


class Viewport(BaseModel):
    x: float = Field(default=0, allow_inf_nan=False, ge=-10000000, le=10000000)
    y: float = Field(default=0, allow_inf_nan=False, ge=-10000000, le=10000000)
    zoom: float = Field(default=1, ge=0.02, le=4)


class VideoFrame(BaseModel):
    width: int = Field(default=1920, ge=256, le=8192)
    height: int = Field(default=1080, ge=256, le=8192)


class CanvasDocument(BaseModel):
    """完整画布快照，包含节点、连线及用于重新打开画布的视口状态。"""

    nodes: list[CanvasNode] = Field(default_factory=list, max_length=1000)
    edges: list[CanvasEdge] = Field(default_factory=list, max_length=2000)
    background: Literal["dots", "lines", "none"] = "dots"
    frame: VideoFrame = Field(default_factory=VideoFrame)
    viewport: Viewport = Field(default_factory=Viewport)


class CanvasWrite(BaseModel):
    """携带客户端读取版本的整份画布保存请求，版本不符时由路由返回 409。"""

    version: int = Field(ge=0)
    document: CanvasDocument


class AssetReference(BaseModel):
    asset_id: UUID


class AssetCopies(BaseModel):
    asset_ids: list[UUID] = Field(max_length=1000)
