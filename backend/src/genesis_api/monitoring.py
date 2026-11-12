"""读取内网 Prometheus 白名单指标，不暴露原始标签或基础设施配置。"""

import asyncio
import math
import time
from typing import Any

import httpx

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


async def snapshot(window: str) -> dict[str, Any]:
    """限时并行读取概况、曲线和容器资源；个别查询失败保留其他指标。"""
    now = int(time.time())
    seconds = {"1h": 3600, "24h": 86400, "7d": 604800}[window]
    errors: list[str] = []
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
        results = await asyncio.gather(
            *(query(key, value, True) for key, value in HOST_QUERIES.items()),
            *(query(key, value) for key, value in CONTAINER_QUERIES.items()),
            *(query(key, value) for key, value in DETAIL_QUERIES.items()),
            query("targets", 'up{job=~"node|node-network|cadvisor"}'),
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
    return {
        "sampled_at": now,
        "window": window,
        "series": series,
        "details": details,
        "containers": sorted(
            containers.values(), key=lambda row: row.get("memory") or 0, reverse=True
        ),
        "targets": targets,
        "errors": errors,
        "available": bool(targets),
        "retention_days": 7,
    }
