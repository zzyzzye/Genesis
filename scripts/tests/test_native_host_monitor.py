"""宿主采集协议测试，仅使用合成数据，不采集测试机进程。"""

import importlib.util
import json
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

import pytest

spec = importlib.util.spec_from_file_location(
    "native_host_monitor", Path(__file__).parents[1] / "native-host-monitor.py"
)
assert spec and spec.loader
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


def test_rate_and_metrics() -> None:
    """首样本、重置与未知值不伪造为零，不导出进程和硬件信息。"""
    assert agent.rate(10, None, 5) is None
    assert agent.rate(1, 10, 5) is None
    assert agent.rate(30, 10, 5) == 4
    result = agent.metrics(
        {"sampled_at": 10, "values": {"cpu": 20, "swap": None}, "items": [{"name": "private"}]}
    )
    assert "genesis_host_cpu 20" in result
    assert "swap" not in result and "private" not in result


def test_hardware_projection(monkeypatch: pytest.MonkeyPatch) -> None:
    """只输出芯片名称，不输出系统报告中的设备序列号。"""
    monkeypatch.setattr(
        agent,
        "command",
        lambda args: (
            "Apple Test"
            if "sysctl" in args[0]
            else json.dumps(
                {"SPDisplaysDataType": [{"sppci_model": "Apple Test GPU", "serial": "private"}]}
            )
        ),
    )
    result = agent.hardware()
    assert result["cpu_names"] == ["Apple Test"]
    assert result["gpus"][0]["name"] == "Apple Test GPU"
    assert "private" not in str(result)


def test_atomic_snapshot(tmp_path: Path) -> None:
    """快照完整替换，临时文件不会被采集为历史指标。"""
    path = tmp_path / "snapshot.json"
    agent.atomic_write(path, '{"sampled_at": 1}', 0o600)
    agent.atomic_write(path, '{"sampled_at": 2}', 0o600)
    assert json.loads(path.read_text())["sampled_at"] == 2
    assert list(tmp_path.iterdir()) == [path]
    assert path.stat().st_mode & 0o777 == 0o600


def test_sampler_resource_fields_and_pid_reuse(monkeypatch: pytest.MonkeyPatch) -> None:
    """仅允许资源方法，首次采集与 PID 复用均不生成虚假 CPU 百分比。"""
    clock, started, seconds = 10.0, 1.0, 1.0
    process = SimpleNamespace(
        pid=42,
        oneshot=nullcontext,
        create_time=lambda: started,
        cpu_times=lambda: SimpleNamespace(user=seconds, system=0),
        name=lambda: "test-process",
        status=lambda: "running",
        memory_info=lambda: SimpleNamespace(rss=1024),
        num_threads=lambda: 2,
    )
    monkeypatch.setattr(agent.time, "monotonic", lambda: clock)
    monkeypatch.setattr(agent.psutil, "cpu_percent", lambda **kwargs: [20, 40])
    monkeypatch.setattr(
        agent.psutil, "virtual_memory", lambda: SimpleNamespace(total=100, available=40)
    )
    monkeypatch.setattr(
        agent.psutil, "disk_usage", lambda path: SimpleNamespace(total=200, free=50)
    )
    monkeypatch.setattr(
        agent.psutil,
        "net_io_counters",
        lambda **kwargs: {
            "en0": SimpleNamespace(bytes_recv=100, bytes_sent=200),
            "lo0": SimpleNamespace(bytes_recv=999, bytes_sent=999),
        },
    )
    monkeypatch.setattr(agent.psutil, "disk_io_counters", lambda: None)
    monkeypatch.setattr(agent.psutil, "swap_memory", lambda: SimpleNamespace(used=0))
    monkeypatch.setattr(agent.psutil, "getloadavg", lambda: (1, 1, 1))
    monkeypatch.setattr(agent.psutil, "process_iter", lambda: iter([process]))
    sampler = agent.Sampler()
    first = sampler.sample()
    assert first["values"]["cpu"] is None and first["items"][0]["cpu"] is None
    assert first["details"]["memory_total"] == 100
    clock, seconds = 15, 2
    second = sampler.sample()
    assert second["values"]["cpu"] == 30
    assert second["items"][0]["cpu"] == 20
    clock, started = 20, 2
    assert sampler.sample()["items"][0]["cpu"] is None


def test_install_waits_for_launchd_release(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """重复安装等待旧任务释放，不要求 root，也不启动额外实例。"""
    attempts = []

    def run(args: list[str], **kwargs: object) -> SimpleNamespace:
        if args[1] == "bootstrap":
            attempts.append(args)
            return SimpleNamespace(returncode=5 if len(attempts) == 1 else 0)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(agent.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(agent.shutil, "which", lambda name: "/synthetic/uv")
    monkeypatch.setattr(agent.subprocess, "run", run)
    monkeypatch.setattr(agent.time, "sleep", lambda seconds: None)
    agent.install()
    assert len(attempts) == 2
    assert (tmp_path / "Library/LaunchAgents" / f"{agent.LABEL}.plist").exists()
