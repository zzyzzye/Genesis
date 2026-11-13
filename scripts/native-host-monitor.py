# /// script
# requires-python = ">=3.12"
# dependencies = ["psutil==7.2.2"]
# ///
"""macOS 宿主采集任务；通过本地文件桥接 Docker，不监听网络端口。"""

import argparse
import fcntl
import json
import math
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import psutil

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "monitoring/runtime"
LABEL = "cn.serenova.genesis.host-monitor"
STATES = {"running": "R", "sleeping": "S", "idle": "I", "stopped": "T", "zombie": "Z"}


def command(args: list[str]) -> str:
    """执行固定硬件命令，不读取环境、参数清单或凭据。"""
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=10).stdout


def hardware() -> dict[str, Any]:
    """仅保留 CPU/GPU 型号，丢弃显示器标识和其他 system_profiler 字段。"""
    result: dict[str, Any] = {
        "cpu_names": [],
        "cpu_state": "unavailable",
        "gpus": [],
        "gpu_state": "unavailable",
    }
    try:
        name = command(["/usr/sbin/sysctl", "-n", "machdep.cpu.brand_string"]).strip()
        result.update(
            cpu_names=[name[:160]] if name else [], cpu_state="available" if name else "unknown"
        )
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        data = json.loads(command(["/usr/sbin/system_profiler", "SPDisplaysDataType", "-json"]))
        rows = data.get("SPDisplaysDataType", [])
        result["gpus"] = [
            {"name": str(row["sppci_model"])[:160], "model_known": True, "pci_id": ""}
            for row in rows[:16]
            if row.get("sppci_model")
        ]
        result["gpu_state"] = (
            "available" if result["gpus"] else "unknown" if rows else "not_detected"
        )
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return result


def rate(current: float, previous: float | None, elapsed: float) -> float | None:
    """首样本和计数器重置保持未知。"""
    if previous is None or elapsed <= 0 or current < previous:
        return None
    return (current - previous) / elapsed


class Sampler:
    """复用 psutil 的原生系统接口，不读取进程启动参数、环境或用户文件。"""

    def __init__(self) -> None:
        self.previous: dict[str, float] = {}
        self.processes: dict[tuple[int, float], float] = {}
        self.at = time.monotonic()
        self.ready = False
        psutil.cpu_percent(percpu=True)

    def sample(self) -> dict[str, Any]:
        """采集实际 macOS 资源，进程按 PID 与启动时间识别。"""
        now, monotonic = time.time(), time.monotonic()
        elapsed = monotonic - self.at
        cores = psutil.cpu_percent(percpu=True)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage(
            "/System/Volumes/Data" if Path("/System/Volumes/Data").exists() else "/"
        )
        network = [
            row
            for name, row in psutil.net_io_counters(pernic=True).items()
            if name.startswith("en")
        ]
        io = psutil.disk_io_counters()
        counters = {
            "receive": float(sum(row.bytes_recv for row in network)),
            "transmit": float(sum(row.bytes_sent for row in network)),
        }
        if io:
            counters.update(read=float(io.read_bytes), write=float(io.write_bytes))
        values = {
            key: rate(value, self.previous.get(key), elapsed) for key, value in counters.items()
        }
        values.update(
            cpu=sum(cores) / len(cores) if self.ready and cores else None,
            memory=(1 - memory.available / memory.total) * 100,
            disk=(1 - disk.free / disk.total) * 100,
            load=psutil.getloadavg()[0],
            swap=psutil.swap_memory().used,
        )
        items, previous = [], {}
        skipped = 0
        # 明确逐项调用，禁止 process_iter 默认展开所有属性。
        for process in psutil.process_iter():
            try:
                with process.oneshot():
                    started = process.create_time()
                    key = (process.pid, started)
                    cpu = process.cpu_times()
                    seconds = cpu.user + cpu.system
                    usage = rate(seconds, self.processes.get(key), elapsed)
                    previous[key] = seconds
                    items.append(
                        {
                            "pid": process.pid,
                            "name": process.name()[:80],
                            "state": STATES.get(process.status(), "unknown"),
                            "scope": "host",
                            "cpu": usage * 100 if usage is not None else None,
                            "memory": process.memory_info().rss,
                            "threads": process.num_threads(),
                            "uptime": max(0, now - started),
                        }
                    )
            except (psutil.Error, OSError):
                skipped += 1
            if len(items) >= 20000:
                break
        self.previous, self.processes, self.at, self.ready = counters, previous, monotonic, True
        return {
            "sampled_at": now,
            "source": "macos",
            "values": values,
            "details": {
                "cores": [
                    {"name": str(i), "usage": value if values["cpu"] is not None else None}
                    for i, value in enumerate(cores)
                ],
                "memory_total": memory.total,
                "memory_available": memory.available,
                "disks": [{"name": "/", "total": disk.total, "available": disk.free}],
            },
            "items": items,
            "skipped": skipped,
            "truncated": len(items) >= 20000,
            "systemd": False,
        }


def metrics(data: dict[str, Any]) -> str:
    """只导出无标签的资源数值，历史不包含进程名或硬件标识。"""
    rows = [f"genesis_host_sampled_at_seconds {data['sampled_at']}"]
    for key, value in data["values"].items():
        if value is not None and math.isfinite(value):
            rows.append(f"genesis_host_{key} {value}")
    return "\n".join(rows) + "\n"


def atomic_write(path: Path, content: str, mode: int) -> None:
    """同目录原子替换，避免读到半份快照。"""
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as target:
        temporary = Path(target.name)
        try:
            target.write(content)
            target.flush()
            os.fchmod(target.fileno(), mode)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def serve(once: bool = False) -> None:
    """单实例采集，每五秒更新；硬件每五分钟刷新。"""
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with (OUTPUT / "agent.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sampler, device_at = Sampler(), 0.0
        device: dict[str, Any] = {}
        while True:
            if time.monotonic() - device_at > 300 or not device:
                device, device_at = hardware(), time.monotonic()
            try:
                data = sampler.sample()
                data["hardware"] = device
                atomic_write(OUTPUT / "snapshot.json", json.dumps(data, allow_nan=False), 0o600)
                atomic_write(OUTPUT / "native.prom", metrics(data), 0o644)
            except (OSError, ValueError, psutil.Error):
                # 不覆盖最后时间戳；后台会将旧快照标记为离线。
                if once:
                    raise
            if once:
                return
            time.sleep(5)


def install() -> None:
    """安装当前用户的 launchd 任务，登录后自动采集，不申请 root。"""
    uv = shutil.which("uv")
    if not uv:
        raise SystemExit("请先安装 uv")
    destination = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
    destination.parent.mkdir(parents=True, exist_ok=True)
    config = {
        "Label": LABEL,
        "ProgramArguments": [uv, "run", "--script", str(Path(__file__).resolve())],
        "WorkingDirectory": str(ROOT),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 30,
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }
    atomic_write(destination, plistlib.dumps(config).decode(), 0o600)
    domain = f"gui/{os.getuid()}"
    subprocess.run(
        ["/bin/launchctl", "bootout", f"{domain}/{LABEL}"], capture_output=True, check=False
    )
    # bootout 返回时旧任务可能仍在退出，等待同名注册释放后再加载。
    for attempt in range(6):
        loaded = subprocess.run(
            ["/bin/launchctl", "bootstrap", domain, str(destination)],
            capture_output=True,
            check=False,
        )
        if loaded.returncode == 0:
            break
        time.sleep(0.5 * (attempt + 1))
    else:
        raise SystemExit("宿主采集任务加载失败；请稍后重新执行 --install。")
    print("macOS 宿主采集任务已安装；每五秒更新，不开放网络端口。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise SystemExit("此采集端仅用于 macOS；Linux 使用现有宿主采集服务。")
    install() if args.install else serve(args.once)
