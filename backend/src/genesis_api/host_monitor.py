"""独立进程采集器；只读取 proc 资源字段，不读取参数、环境或文件内容。"""

import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any


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

    def collect() -> None:
        nonlocal snapshot
        while True:
            try:
                snapshot = json.dumps(sampler.sample(), allow_nan=False).encode()
            except (OSError, ValueError):
                snapshot = None
            time.sleep(5)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            """只返回已采集的安全投影。"""
            data = snapshot
            if self.path != "/snapshot":
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
