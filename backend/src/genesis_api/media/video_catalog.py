"""供应商 2026-09-21 文档能力快照；仅与实时模型目录取交集，不冒充可用列表。"""

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class VideoModel:
    """公开参数范围，未知模型不猜测其输入要求。"""

    id: str
    ratios: list[str]
    durations: list[int]
    resolutions: list[str]
    images: int
    videos: int = 0
    audio: bool = False
    max_audio: int = 0

    def data(self) -> dict[str, object]:
        """返回前端可以消费的模型能力，不包含连接配置。"""
        return asdict(self)


CATALOG: dict[str, VideoModel] = {}
WIDE = "16:9 9:16 4:3 3:4 1:1 21:9"
PORTRAIT = "16:9 9:16 1:1"


def _add(
    names: list[str],
    durations: range | list[int],
    resolutions: str,
    images: int,
    videos: int = 0,
    audio: bool = False,
    ratios: str = WIDE,
) -> None:
    for name in names:
        CATALOG[name] = VideoModel(
            name,
            ratios.split(),
            list(durations),
            resolutions.split(),
            images,
            videos,
            audio,
            (10 if images >= 30 or videos >= 10 else 5 if name.startswith("wan3.0-") else 3)
            if audio
            else 0,
        )


for _quality in ("2k", "480p", "720p"):
    _names = [f"MiniMaxH3-{_quality}", f"MiniMaxH3-{_quality}-按次"]
    if _quality == "2k":
        _names += ["MiniMaxH3-2k-pro", "MiniMaxH3-2k-pro-按次"]
    _add(_names, range(4, 16), _quality, 9, audio=True)
_add(["gemini-omni-flash"], range(3, 11), "720p", 4, 1, ratios="16:9 9:16")
_add(["grok-imagine-video"], range(1, 16), "480p 720p 1080p", 1, ratios="16:9 9:16")
_add(
    ["grok-imagine-video-1.5"],
    range(1, 16),
    "480p 720p 1080p",
    7,
    ratios="16:9 9:16 1:1 4:3 3:4 2:3 3:2",
)
_add(["kl-o3"], range(3, 16), "720p 1080p 2160p", 7, 1, ratios=PORTRAIT)
_add(["kl-o3-standard-v2v-reference"], range(3, 16), "720p 1080p 2160p", 4, 1, ratios=PORTRAIT)
_add(["kl-v3"], range(3, 16), "720p 1080p 2160p", 2, ratios=PORTRAIT)
_add(
    [
        "manxue2-933-720p-cf",
        "v1-seedance-2.0-933-720p-15s",
        "v1-seedance-2.0-933-mini-720p-15s",
        "特价-manxue-2.0-933-720p-15s",
    ],
    [15],
    "720p",
    9,
    3,
    True,
)
_add(["manxue2.5-720p-301010"], range(4, 16), "720p", 30, 10, True)
for _length in (10, 15):
    _name = f"minimax-h3-900-{'1080-' if _length == 10 else ''}{_length}s"
    _add([_name], range(1, _length + 1), "768p", 9, ratios=PORTRAIT)
    _add(
        [f"minimax-h3-930-{_length}s"],
        range(1, _length + 1),
        "768p",
        9,
        audio=True,
        ratios=PORTRAIT,
    )
_add(
    ["minimax-h3-升级画质", "minimax-h3-高速版"],
    range(1, 16),
    "768p",
    9,
    audio=True,
    ratios=PORTRAIT,
)
_add(["minimax-h3-纯文生"], range(1, 16), "768p", 0, ratios=PORTRAIT)
_add(["minimax-h3-首尾帧"], range(1, 16), "768p", 2, ratios=PORTRAIT)
_add(["minimax-h3-音频+图片对口型-15s"], range(1, 16), "768p", 1, audio=True, ratios=PORTRAIT)
_add(["sd2-933-mini-720p-12s"], [12], "720p", 9, 3, True)
_add(["sd25-30s"], [30], "720p", 30, audio=True)
for _quality in ("480p", "720p"):
    _add([f"seedance-2.0-{_quality}"], range(4, 16), _quality, 9, 3, True)
    _add([f"seedance-2.5-{_quality}"], range(4, 31), _quality, 9, 3, True)
_add(["v1-seedance-2.0-933-480p-15s"], [15], "480p", 9, 3, True)
_add(["wan2.2animate-v4-动作迁移"], range(5, 61), "1080p", 1, 1, ratios=PORTRAIT)
for _quality in ("480p", "720p", "1080p"):
    _add([f"wan3.0-{_quality}", f"wan3.0-{_quality}-prime"], range(5, 31), _quality, 10, 5, True)
_add(["特价-manxue-2.5-101010-720p-30s"], [30], "720p", 10, 10, True, ratios="16:9 9:16 1:1 4:3")
_add(["特价-manxue-2.5-301010-720p-30s"], [30], "720p", 30, 10, True)
_add(["特价-manxue-2.5-900-30s"], [30], "720p", 9, ratios=PORTRAIT)
