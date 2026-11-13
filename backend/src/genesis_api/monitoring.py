"""读取内网 Prometheus 白名单指标，不暴露原始标签或基础设施配置。"""

import asyncio
import json
import math
import time
from pathlib import Path
from typing import Any

import httpx

NATIVE_SNAPSHOT = Path("/host-monitor/snapshot.json")


def native_snapshot() -> dict[str, Any] | None:
    """读取固定宿主桥接路径；已接入但失联时拒绝回退到 Docker 虚拟机。"""
    if not NATIVE_SNAPSHOT.exists():
        return None
    try:
        data: dict[str, Any] = json.loads(NATIVE_SNAPSHOT.read_text())
        sampled_at = float(data["sampled_at"])
        if data.get("source") != "macos" or not 0 <= time.time() - sampled_at <= 30:
            raise ValueError("macOS 宿主快照已过期或来源无效")
        if not all(isinstance(data.get(key), dict) for key in ("hardware", "details", "values")):
            raise ValueError("macOS 宿主快照字段不完整")
        if not isinstance(data.get("items"), list) or "systemd" not in data:
            raise ValueError("macOS 宿主进程快照字段不完整")
        return data
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("macOS 宿主快照不可用") from exc


FILESYSTEM = '{job="node",fstype!~"tmpfs|overlay|squashfs|iso9660"}'
HOST_QUERIES = {
    "cpu": '100 * (1 - avg(rate(node_cpu_seconds_total{job="node",mode="idle"}[5m])))',
    "memory": (
        '100 * (1 - sum(node_memory_MemAvailable_bytes{job="node"}) / '
        'sum(node_memory_MemTotal_bytes{job="node"}))'
    ),
    "disk": (
        f"max((100 * (1 - node_filesystem_avail_bytes{FILESYSTEM} / "
        f"node_filesystem_size_bytes{FILESYSTEM})) and "
        f"(node_filesystem_readonly{FILESYSTEM} == 0))"
    ),
    "receive": (
        "sum(rate(node_network_receive_bytes_total"
        '{job="node-network",device!~"lo|veth.*|docker.*|br-.*"}[5m]))'
    ),
    "transmit": (
        "sum(rate(node_network_transmit_bytes_total"
        '{job="node-network",device!~"lo|veth.*|docker.*|br-.*"}[5m]))'
    ),
    "load": 'sum(node_load1{job="node"})',
    "swap": 'sum(node_memory_SwapTotal_bytes{job="node"} - node_memory_SwapFree_bytes{job="node"})',
    "read": 'sum(rate(node_disk_read_bytes_total{job="node",device!~"loop.*|ram.*"}[5m]))',
    "write": 'sum(rate(node_disk_written_bytes_total{job="node",device!~"loop.*|ram.*"}[5m]))',
}
CONTAINER_QUERIES = {
    "cpu": (
        "sum by (name) (rate(container_cpu_usage_seconds_total"
        '{job="cadvisor",name!="",image!=""}[5m])) * 100'
    ),
    "memory": (
        'max by (name) (container_memory_working_set_bytes{job="cadvisor",name!="",image!=""})'
    ),
    "receive": (
        "sum by (name) (rate(container_network_receive_bytes_total"
        '{job="cadvisor",name!="",image!=""}[5m]))'
    ),
    "transmit": (
        "sum by (name) (rate(container_network_transmit_bytes_total"
        '{job="cadvisor",name!="",image!=""}[5m]))'
    ),
    "uptime": (
        'time() - max by (name) (container_start_time_seconds{job="cadvisor",name!="",image!=""})'
    ),
    "read": (
        "sum by (name) (rate(container_fs_reads_bytes_total"
        '{job="cadvisor",name!="",image!=""}[5m]))'
    ),
    "write": (
        "sum by (name) (rate(container_fs_writes_bytes_total"
        '{job="cadvisor",name!="",image!=""}[5m]))'
    ),
}
DETAIL_QUERIES = {
    "cores": '100 * (1 - rate(node_cpu_seconds_total{job="node",mode="idle"}[5m]))',
    "memory_total": 'sum(node_memory_MemTotal_bytes{job="node"})',
    "memory_available": 'sum(node_memory_MemAvailable_bytes{job="node"})',
    "disk_total": (
        f"node_filesystem_size_bytes{FILESYSTEM} and (node_filesystem_readonly{FILESYSTEM} == 0)"
    ),
    "disk_available": (
        f"node_filesystem_avail_bytes{FILESYSTEM} and (node_filesystem_readonly{FILESYSTEM} == 0)"
    ),
}


def number(value: Any) -> float | None:
    """非有限值表示没有有效样本，不能当成零占用。"""
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


async def host_snapshot() -> dict[str, Any]:
    """读取固定内网进程快照，拒绝过期样本。"""
    native = native_snapshot()
    if native is not None:
        return native
    async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
        result = await client.get("http://host-processes:9101/snapshot")
        result.raise_for_status()
        data: dict[str, Any] = result.json()
        if time.time() - float(data["sampled_at"]) > 30:
            raise ValueError("进程样本已过期")
        return data


async def system_services() -> dict[str, Any]:
    """复用 node_exporter 的 systemd 采集，仅输出服务状态与计数。"""
    queries = [
        'node_scrape_collector_success{job="systemd",collector="systemd"} '
        'and on(instance) (up{job="systemd"} == 1)',
        'node_systemd_unit_state{job="systemd",name=~".+\\\\.service"} == 1',
        'node_systemd_service_restart_total{job="systemd"}',
        'node_systemd_unit_start_time_seconds{job="systemd"}',
    ]
    async with httpx.AsyncClient(
        base_url="http://prometheus:9090", timeout=5, trust_env=False
    ) as client:

        async def query(expression: str) -> list[Any]:
            result = await client.get(
                "/api/v1/query", params={"query": expression, "timeout": "3s"}
            )
            result.raise_for_status()
            data = result.json()
            if data.get("status") != "success":
                raise ValueError("服务采集查询失败")
            return list(data["data"]["result"])

        health, states, restarts, starts = await asyncio.gather(*(query(q) for q in queries))
    if not health or number(health[0]["value"][1]) != 1:
        raise ValueError("systemd 采集不可用")
    rows = {
        str(row["metric"]["name"])[:200]: {
            "name": str(row["metric"]["name"])[:200],
            "state": row["metric"].get("state", "unknown"),
            "restarts": None,
            "uptime": None,
        }
        for row in states
    }
    for field, values in [("restarts", restarts), ("uptime", starts)]:
        for row in values:
            name = str(row["metric"]["name"])[:200]
            value = number(row["value"][1])
            if name in rows:
                if field == "uptime":
                    value = (
                        max(0, time.time() - value)
                        if value and rows[name]["state"] == "active"
                        else None
                    )
                rows[name][field] = value
    return {"sampled_at": time.time(), "items": list(rows.values())}


async def hardware_info() -> dict[str, Any]:
    """读取独立硬件快照并投影允许字段；旧采集器或采集失败不影响资源图。"""
    unavailable = {
        "cpu_names": [],
        "cpu_state": "unavailable",
        "gpus": [],
        "gpu_state": "unavailable",
    }
    try:
        native = native_snapshot()
        if native is not None:
            return dict(native["hardware"])
        async with httpx.AsyncClient(timeout=3, trust_env=False) as client:
            response = await client.get("http://host-processes:9101/hardware")
            response.raise_for_status()
            data = response.json()
        sampled_at = number(data.get("sampled_at"))
        if sampled_at is None or not 0 <= time.time() - sampled_at <= 180:
            return unavailable
        states = {"available", "unknown", "not_detected", "partial", "unavailable"}
        return {
            "cpu_names": [str(name)[:160] for name in data["cpu_names"][:16]],
            "cpu_state": data["cpu_state"] if data["cpu_state"] in states else "unavailable",
            "gpus": [
                {
                    "name": str(row["name"])[:160],
                    "model_known": row.get("model_known") is True,
                    "pci_id": str(row.get("pci_id", ""))[:16],
                }
                for row in data["gpus"][:64]
            ],
            "gpu_state": data["gpu_state"] if data["gpu_state"] in states else "unavailable",
        }
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        return unavailable


async def snapshot(window: str) -> dict[str, Any]:
    """限时并行读取概况、曲线和容器资源；个别查询失败保留其他指标。"""
    now = int(time.time())
    seconds = {"1h": 3600, "24h": 86400, "7d": 604800}[window]
    errors: list[str] = []
    native_enabled = NATIVE_SNAPSHOT.exists()
    try:
        native = native_snapshot()
    except ValueError:
        native = None
        errors.append("native_host")
    host_queries = (
        {
            key: f'genesis_host_{key}{{job="node"}} and on(job,instance) '
            '(time() - genesis_host_sampled_at_seconds{job="node"} < 30)'
            for key in HOST_QUERIES
        }
        if native_enabled
        else HOST_QUERIES
    )
    async with httpx.AsyncClient(
        base_url="http://prometheus:9090", timeout=5, trust_env=False
    ) as client:

        async def query(key: str, expression: str, history: bool = False) -> list[Any]:
            params = {"query": expression, "timeout": "3s"}
            if history:
                params.update(start=str(now - seconds), end=str(now), step=str(seconds // 120))
            try:
                result = await client.get(
                    "/api/v1/query_range" if history else "/api/v1/query", params=params
                )
                result.raise_for_status()
                data = result.json()
                if data.get("status") != "success":
                    raise ValueError("监控查询失败")
                return list(data["data"]["result"])
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                errors.append(key)
                return []

        host_keys = list(HOST_QUERIES)
        container_keys = list(CONTAINER_QUERIES)
        hardware, results = await asyncio.gather(
            hardware_info(),
            asyncio.gather(
                *(query(key, value, True) for key, value in host_queries.items()),
                *(query(key, value) for key, value in CONTAINER_QUERIES.items()),
                *(query(key, value) for key, value in DETAIL_QUERIES.items()),
                query("targets", 'up{job=~"node|node-network|cadvisor"}'),
            ),
        )
    series = {}
    for key, rows in zip(host_keys, results[: len(host_keys)], strict=True):
        series[key] = [[point[0], number(point[1])] for point in rows[0]["values"]] if rows else []
    containers: dict[str, dict[str, Any]] = {}
    boundary = len(host_keys) + len(container_keys)
    for key, rows in zip(container_keys, results[len(host_keys) : boundary], strict=True):
        for row in rows[:200]:
            name = str(row["metric"].get("name", ""))[:150]
            containers.setdefault(name, {"name": name})[key] = number(row["value"][1])
    targets = [
        {"name": row["metric"].get("job"), "up": number(row["value"][1]) == 1}
        for row in results[-1]
    ]
    details: dict[str, Any] = {}
    disks: dict[str, dict[str, Any]] = {}
    for key, rows in zip(DETAIL_QUERIES, results[boundary:-1], strict=True):
        if key == "cores":
            details[key] = [
                {"name": str(row["metric"].get("cpu", "")), "usage": number(row["value"][1])}
                for row in rows[:256]
            ]
        elif key.startswith("disk_"):
            for row in rows[:100]:
                name = str(row["metric"].get("mountpoint", ""))[:200]
                disks.setdefault(name, {"name": name})[key.removeprefix("disk_")] = number(
                    row["value"][1]
                )
        else:
            details[key] = number(rows[0]["value"][1]) if rows else None
    details["disks"] = sorted(disks.values(), key=lambda row: row["name"])
    container_memory_total = details.get("memory_total")
    if native_enabled:
        details = native["details"] if native else {"cores": [], "disks": []}
        targets = [row for row in targets if row["name"] == "cadvisor"]
        targets.insert(0, {"name": "native-host", "up": native is not None})
        if native is None:
            series = {key: [] for key in HOST_QUERIES}
    return {
        "sampled_at": native["sampled_at"] if native else now,
        "window": window,
        "series": series,
        "details": details,
        "hardware": hardware,
        "source": "macos" if native_enabled else "linux",
        "current": native["values"] if native else None,
        "container_memory_total": container_memory_total,
        "containers": sorted(
            containers.values(), key=lambda row: row.get("memory") or 0, reverse=True
        ),
        "targets": targets,
        "errors": errors,
        "available": native is not None if native_enabled else bool(targets),
        "retention_days": 7,
    }
