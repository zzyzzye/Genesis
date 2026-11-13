"""独立宿主采集器；只读取资源与硬件白名单，不读取进程参数或环境。"""

import json
import os
import re
import threading
import time
from contextlib import suppress
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any


def hardware_snapshot(
    proc: Path = Path("/host/proc"), sys: Path = Path("/host/sys")
) -> dict[str, Any]:
    """读取 CPU 型号与可见显示设备；不返回序列号、UUID 或原始硬件文本。

    GPU 名称优先使用驱动型号，缺失时仅返回厂商与 PCI ID，不猜测型号。
    未发现设备只代表当前 Linux 主机可见范围，不代表物理机没有 GPU。
    """
    cpus: list[str] = []
    cpu_state = "unavailable"
    try:
        with (proc / "cpuinfo").open() as source:
            for line in source:
                key, _, value = line.partition(":")
                if key.strip() in {"model name", "Hardware"} and value.strip():
                    name = value.strip()[:160]
                    if name not in cpus:
                        cpus.append(name)
        cpu_state = "available" if cpus else "unknown"
    except OSError:
        pass

    gpus: list[dict[str, Any]] = []
    gpu_state = "available"
    try:
        devices = sorted((sys / "bus/pci/devices").iterdir())
        for device in devices:
            if int((device / "class").read_text().strip(), 16) >> 16 != 3:
                continue
            vendor = (device / "vendor").read_text().strip().removeprefix("0x")
            product = (device / "device").read_text().strip().removeprefix("0x")
            model = None
            # NVIDIA 的信息文件还含有标识字段，只选取 Model 一行。
            try:
                with (proc / "driver/nvidia/gpus" / device.name / "information").open() as source:
                    for line in source:
                        key, _, value = line.partition(":")
                        if key.strip() == "Model" and value.strip():
                            model = value.strip()[:160]
                            break
            except OSError:
                pass
            if not model:
                with suppress(OSError):
                    model = (device / "product_name").read_text().strip()[:160] or None
            maker = {"10de": "NVIDIA", "1002": "AMD", "8086": "Intel"}.get(vendor, "显示设备")
            gpus.append(
                {
                    "name": model or maker,
                    "model_known": bool(model),
                    "pci_id": f"{vendor}:{product}",
                }
            )
            if len(gpus) >= 64:
                break
        # 部分 SoC 显卡不在 PCI 总线上，不能误报为没有设备。
        if not gpus:
            cards = list((sys / "class/drm").glob("card[0-9]*"))
            gpu_state = (
                "unknown"
                if any(re.fullmatch(r"card\d+", card.name) for card in cards)
                else "not_detected"
            )
    except (OSError, ValueError):
        gpu_state = "partial" if gpus else "unavailable"
    return {
        "sampled_at": time.time(),
        "cpu_names": cpus[:16],
        "cpu_state": cpu_state,
        "gpus": gpus,
        "gpu_state": gpu_state,
    }


class Sampler:
    """用 PID 与启动时刻共同识别进程，避免 PID 复用造成虚假的 CPU 跃升。"""

    def __init__(self, root: Path = Path("/host/proc")) -> None:
        self.root = root
        self.previous: dict[tuple[int, int], tuple[float, float]] = {}
        self.ticks = os.sysconf("SC_CLK_TCK")
        self.page_size = os.sysconf("SC_PAGE_SIZE")

    def sample(self) -> dict[str, Any]:
        """读取当前快照；退出或无权限的进程跳过，首个 CPU 样本保持未知。"""
        now = time.monotonic()
        uptime = float((self.root / "uptime").read_text().split()[0])
        systemd = (self.root / "1/comm").read_text().strip() == "systemd"
        items = []
        previous = {}
        skipped = 0
        directories = sorted(int(path.name) for path in self.root.iterdir() if path.name.isdigit())
        for pid in directories[:20000]:
            try:
                path = self.root / str(pid)
                raw = (path / "stat").read_text()
                end = raw.rfind(")")
                fields = raw[end + 2 :].split()
                name = raw[raw.index("(") + 1 : end][:80]
                started = int(fields[19])
                cpu_seconds = (int(fields[11]) + int(fields[12])) / self.ticks
                key = (pid, started)
                old = self.previous.get(key)
                cpu = None
                if old and now > old[0] and cpu_seconds >= old[1]:
                    cpu = (cpu_seconds - old[1]) / (now - old[0]) * 100
                previous[key] = (now, cpu_seconds)
                try:
                    groups = (path / "cgroup").read_text()
                    # 只用资源组识别容器边界，不输出原始路径或读取启动参数。
                    container_group = re.search(
                        r"/docker/|/docker-[0-9a-f]{12,64}\.scope|/kubepods(?:/|[.-])"
                        r"|/libpod-[0-9a-f]+\.scope|/lxc(?:/|[.])",
                        groups,
                    )
                    scope = "isolated" if container_group else "host"
                except OSError:
                    scope = "unknown"
                items.append(
                    {
                        "pid": pid,
                        "name": name,
                        "state": fields[0],
                        "scope": scope,
                        "cpu": cpu,
                        "memory": max(0, int(fields[21])) * self.page_size,
                        "threads": int(fields[17]),
                        "uptime": max(0, uptime - started / self.ticks),
                    }
                )
            except (OSError, ValueError, IndexError):
                skipped += 1
        self.previous = previous
        return {
            "sampled_at": time.time(),
            "items": items,
            "systemd": systemd,
            "skipped": skipped,
            "truncated": len(directories) > 20000,
        }


def serve() -> None:
    """内网固定快照端点，不接受文件路径、命令或任何写操作。"""
    sampler = Sampler()
    snapshot: bytes | None = None
    hardware: bytes | None = None

    def collect() -> None:
        nonlocal snapshot, hardware
        hardware_at = 0.0
        while True:
            if time.monotonic() - hardware_at >= 60 or hardware is None:
                hardware = json.dumps(hardware_snapshot(), allow_nan=False).encode()
                hardware_at = time.monotonic()
            try:
                snapshot = json.dumps(sampler.sample(), allow_nan=False).encode()
            except (OSError, ValueError):
                snapshot = None
            time.sleep(5)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            """只返回已采集的安全投影。"""
            data = hardware if self.path == "/hardware" else snapshot
            if self.path not in {"/snapshot", "/hardware"}:
                self.send_error(404)
                return
            self.send_response(200 if data else 503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data or b"{}")

        def log_message(self, format: str, *args: Any) -> None:
            """不记录进程名或请求内容。"""

    threading.Thread(target=collect, daemon=True).start()
    HTTPServer(("0.0.0.0", 9101), Handler).serve_forever()


if __name__ == "__main__":
    serve()
