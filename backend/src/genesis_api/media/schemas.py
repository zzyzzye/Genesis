from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProjectWrite(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)


class CanvasNode(BaseModel):
    id: UUID
    type: Literal["asset", "note", "text", "shape"]
    asset_id: UUID | None = None
    text: str = Field(default="", max_length=20000)
    x: float = Field(allow_inf_nan=False, ge=-1000000, le=1000000)
    y: float = Field(allow_inf_nan=False, ge=-1000000, le=1000000)
    width: float = Field(ge=100, le=4000)
    height: float = Field(ge=80, le=4000)


class Viewport(BaseModel):
    x: float = Field(default=0, allow_inf_nan=False, ge=-10000000, le=10000000)
    y: float = Field(default=0, allow_inf_nan=False, ge=-10000000, le=10000000)
    zoom: float = Field(default=1, ge=0.1, le=4)


class CanvasDocument(BaseModel):
    nodes: list[CanvasNode] = Field(default_factory=list, max_length=1000)
    viewport: Viewport = Field(default_factory=Viewport)


class CanvasWrite(BaseModel):
    version: int = Field(ge=0)
    document: CanvasDocument


class AssetReference(BaseModel):
    asset_id: UUID


class AssetCopies(BaseModel):
    asset_ids: list[UUID] = Field(max_length=1000)
