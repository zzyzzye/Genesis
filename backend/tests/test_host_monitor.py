"""使用合成 proc 与监控响应验证宿主采集，不读取真实进程参数。"""

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from genesis_api import host_monitor, monitoring


@pytest.mark.anyio
async def test_native_host_source_and_stale_no_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """宿主资源不混用虚拟机详情，过期后不回退到虚拟机或进程端点。"""
    now = monitoring.time.time()
    native = {
        "sampled_at": now,
        "source": "macos",
        "hardware": {"cpu_names": ["Test Mac"], "gpus": []},
        "details": {
            "memory_total": 16 * 1024**3,
            "memory_available": 8 * 1024**3,
            "cores": [],
            "disks": [],
        },
        "values": {"cpu": 20},
        "items": [],
        "systemd": False,
    }
    monitoring.NATIVE_SNAPSHOT.write_text(json.dumps(native))
    queries = []

    async def get(self: httpx.AsyncClient, url: str, **kwargs: Any) -> httpx.Response:
        assert self.base_url.host == "prometheus"
        queries.append(kwargs["params"]["query"])
        return httpx.Response(
            200,
            json={"status": "success", "data": {"result": []}},
            request=httpx.Request("GET", "http://prometheus"),
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    data = await monitoring.snapshot("1h")
    assert data["source"] == "macos"
    assert data["details"]["memory_total"] == 16 * 1024**3
    assert data["current"]["cpu"] == 20
    assert any("genesis_host_cpu" in query for query in queries)
    assert not any("rate(node_cpu_seconds_total" in query and "avg" in query for query in queries)
    assert (await monitoring.host_snapshot())["source"] == "macos"
    native["sampled_at"] = 0
    monitoring.NATIVE_SNAPSHOT.write_text(json.dumps(native))
    data = await monitoring.snapshot("1h")
    assert data["source"] == "macos" and data["available"] is False
    assert data["series"]["cpu"] == []
    assert "memory_total" not in data["details"]
    with pytest.raises(ValueError, match="过期"):
        await monitoring.host_snapshot()


def test_hardware_models_and_missing(tmp_path: Path) -> None:
    """型号去重，驱动字段严格筛选，未知型号与不可见硬件分开。"""
    proc, sys = tmp_path / "proc", tmp_path / "sys"
    proc.mkdir()
    (proc / "cpuinfo").write_text(
        "model name : Test CPU\nmodel name : Test CPU\nSerial : private\n"
    )
    pci = sys / "bus/pci/devices"
    pci.mkdir(parents=True)
    for address, vendor in [("0000:01:00.0", "10de"), ("0000:02:00.0", "1002")]:
        device = pci / address
        device.mkdir()
        (device / "class").write_text("0x030200")
        (device / "vendor").write_text(f"0x{vendor}")
        (device / "device").write_text("0x1234")
    nvidia = proc / "driver/nvidia/gpus/0000:01:00.0"
    nvidia.mkdir(parents=True)
    (nvidia / "information").write_text("Model: NVIDIA Test GPU\nGPU UUID: private\n")
    result = host_monitor.hardware_snapshot(proc, sys)
    assert result["cpu_names"] == ["Test CPU"]
    assert result["gpu_state"] == "available"
    assert result["gpus"][0]["name"] == "NVIDIA Test GPU"
    assert result["gpus"][1] == {"name": "AMD", "model_known": False, "pci_id": "1002:1234"}
    assert "private" not in str(result)
    assert host_monitor.hardware_snapshot(proc, tmp_path / "missing")["gpu_state"] == "unavailable"
    empty_sys = tmp_path / "empty"
    (empty_sys / "bus/pci/devices").mkdir(parents=True)
    assert host_monitor.hardware_snapshot(proc, empty_sys)["gpu_state"] == "not_detected"
    (empty_sys / "class/drm/card0").mkdir(parents=True)
    assert host_monitor.hardware_snapshot(proc, empty_sys)["gpu_state"] == "unknown"


@pytest.mark.anyio
async def test_hardware_projection_and_staleness(monkeypatch: pytest.MonkeyPatch) -> None:
    """硬件端点去除标识字段，过期时降级，不把失败说成没有显卡。"""
    sampled_at = monitoring.time.time()

    async def get(self: httpx.AsyncClient, url: str, **kwargs: Any) -> httpx.Response:
        assert url == "http://host-processes:9101/hardware"
        return httpx.Response(
            200,
            json={
                "sampled_at": sampled_at,
                "cpu_names": ["Test CPU"],
                "cpu_state": "available",
                "gpu_state": "available",
                "gpus": [
                    {
                        "name": "Test GPU",
                        "model_known": True,
                        "pci_id": "1234:5678",
                        "uuid": "private",
                    }
                ],
                "serial": "private",
            },
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    assert "private" not in str(await monitoring.hardware_info())
    sampled_at = 0
    assert (await monitoring.hardware_info())["gpu_state"] == "unavailable"


def test_sampler_pid_reuse_and_privacy(monkeypatch: pytest.MonkeyPatch) -> None:
    """CPU 使用差分，PID 复用重置，采集文件仅限资源白名单。"""
    ticks = 200
    started = 100
    clock = 10.0
    group = "0::/system.slice/docker.service"
    reads: list[str] = []

    def read(path: Path, *args: Any, **kwargs: Any) -> str:
        reads.append(path.name)
        if path.name == "uptime":
            return "1000 1000"
        if path.name == "comm":
            return "systemd"
        if path.name == "cgroup":
            return group
        if path.name == "stat":
            fields = ["0"] * 22
            fields[0], fields[11], fields[19], fields[21] = "S", str(ticks), str(started), "4"
            return "42 (worker (test)) " + " ".join(fields)
        raise AssertionError("采集器访问了非白名单文件")

    monkeypatch.setattr(Path, "read_text", read)
    monkeypatch.setattr(Path, "iterdir", lambda _: iter([Path("42")]))
    monkeypatch.setattr(host_monitor.time, "monotonic", lambda: clock)
    sampler = host_monitor.Sampler(Path("/synthetic"))
    sampler.ticks = 100
    first = sampler.sample()["items"][0]
    assert first["cpu"] is None
    assert first["name"] == "worker (test)"
    assert first["scope"] == "host"
    ticks, clock = 400, 12
    assert sampler.sample()["items"][0]["cpu"] == 100
    started, ticks, clock = 200, 9000, 14
    assert sampler.sample()["items"][0]["cpu"] is None
    group = "0::/system.slice/docker-" + "a" * 64 + ".scope"
    assert sampler.sample()["items"][0]["scope"] == "isolated"
    assert set(reads) == {"stat", "comm", "cgroup", "uptime"}


@pytest.mark.anyio
async def test_stale_process_sample(monkeypatch: pytest.MonkeyPatch) -> None:
    """旧样本不能被重新包装成当前资源数据。"""

    async def get(self: httpx.AsyncClient, url: str, **kwargs: Any) -> httpx.Response:
        assert url == "http://host-processes:9101/snapshot"
        return httpx.Response(200, json={"sampled_at": 0}, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    with pytest.raises(ValueError, match="过期"):
        await monitoring.host_snapshot()


@pytest.mark.anyio
async def test_systemd_projection_and_collector_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """systemd 失败时不展示旧的正常状态，也不返回原始标签。"""
    healthy = True

    async def get(self: httpx.AsyncClient, url: str, **kwargs: Any) -> httpx.Response:
        expression = kwargs["params"]["query"]
        value = "1"
        if "collector_success" in expression:
            value = "1" if healthy else "0"
        elif "restart_total" in expression:
            value = "3"
        elif "start_time" in expression:
            value = "0"
        row = {
            "metric": {"name": "example.service", "state": "failed", "private": "hidden"},
            "value": [0, value],
        }
        return httpx.Response(
            200,
            json={"status": "success", "data": {"result": [row]}},
            request=httpx.Request("GET", "http://prometheus"),
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    result = await monitoring.system_services()
    assert result["items"] == [
        {"name": "example.service", "state": "failed", "restarts": 3, "uptime": None}
    ]
    assert "hidden" not in str(result)
    healthy = False
    with pytest.raises(ValueError, match="不可用"):
        await monitoring.system_services()
