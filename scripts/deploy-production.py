"""仅在 Linux 部署服务器增量发布，源码与静态产物挂载，不读取秘密配置。"""

import argparse
import hashlib
import json
import platform
import subprocess
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".genesis-deploy" / "state.json"
COMPOSE = [
    "docker", "compose", "--env-file", ".env.production",
    "-f", "compose.prod.yml", "-f", "compose.monitoring.yml",
]
MONITORING_SERVICES = [
    "prometheus", "node-exporter", "node-network", "cadvisor", "host-processes",
]


def start_monitoring() -> None:
    """将采集服务接入生产网络；仅在宿主提供总线时启用 systemd 采集。"""
    services = list(MONITORING_SERVICES)
    if Path("/run/dbus/system_bus_socket").is_socket():
        services.append("node-systemd")
    run("up", "-d", "--no-build", "--no-deps", "--wait", "--wait-timeout", "180", *services)


def fingerprint(paths: list[str]) -> str:
    """只计算受版本控制的非环境文件，不读取或输出部署凭据。"""
    files = subprocess.check_output(["git", "ls-files", "-z", "--", *paths], cwd=ROOT)
    digest = hashlib.sha256()
    for raw in sorted(files.split(b"\0")):
        if not raw:
            continue
        path = Path(raw.decode())
        if any(part.startswith(".env") for part in path.parts):
            continue
        digest.update(raw)
        source = ROOT / path
        digest.update(source.read_bytes() if source.is_file() else b"deleted")
    return digest.hexdigest()


def run(*args: str, quiet: bool = False, check: bool = True) -> subprocess.CompletedProcess[bytes]:
    """运行 Compose；不展开或打印包含秘密的配置。"""
    return subprocess.run(
        [*COMPOSE, *args], cwd=ROOT, check=check,
        stdout=subprocess.DEVNULL if quiet else None,
        stderr=subprocess.DEVNULL if quiet else None,
    )


def deploy(plan: bool = False, rebuild_backend: bool = False) -> None:
    """比较成功发布指纹，按依赖、源码和静态文件范围分别更新。"""
    old = json.loads(STATE.read_text()) if STATE.exists() else {}
    current = {
        "dependencies": fingerprint([
            "backend/Dockerfile", "backend/pyproject.toml", "backend/uv.lock",
        ]),
        "backend": fingerprint(["backend/src", "backend/alembic", "backend/alembic.ini"]),
        "frontend": fingerprint(["frontend", "scripts/production-frontend.sh"]),
    }
    build_backend = rebuild_backend or current["dependencies"] != old.get("dependencies")
    update_backend = build_backend or current["backend"] != old.get("backend")
    build_frontend = current["frontend"] != old.get("frontend")
    print(f"后端镜像：{'重建' if build_backend else '复用'}；"
          f"后端代码：{'重启加载' if update_backend else '无变化'}；"
          f"前端静态文件：{'编译' if build_frontend else '复用'}", flush=True)
    if plan:
        return
    # 本地 Mac 只允许查看计划；不通过容器绕过禁止本地打包的约定。
    if platform.system() != "Linux":
        raise SystemExit("生产发布仅允许在 Linux 部署服务器执行；本地可用 --plan。")
    # 在构建与迁移前检查配置，避免部署到一半才发现结构错误。
    run("config", "--quiet")
    start_monitoring()
    if not build_backend:
        missing = subprocess.run(
            ["docker", "image", "inspect", "genesis-production-backend"], cwd=ROOT,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
        ).returncode != 0
        build_backend = missing
        update_backend = update_backend or missing
    if not build_frontend:
        build_frontend = run("run", "--rm", "--no-deps", "frontend-build", "check",
                             quiet=True, check=False).returncode != 0
    release = uuid4().hex
    if build_frontend:
        run("run", "--rm", "--no-deps", "frontend-build", "build", release)
    if build_backend:
        # migrate 与 backend 共用同一个镜像，只构建一次。
        run("build", "backend")
    run("up", "-d", "--no-build", "--wait", "--wait-timeout", "180", "postgres")
    run("run", "--rm", "--no-deps", "migrate")
    backend_args = ["up", "-d", "--no-build", "--no-deps", "--wait", "--wait-timeout", "180"]
    if update_backend:
        backend_args.append("--force-recreate")
    run(*backend_args, "backend")
    if build_frontend:
        run("run", "--rm", "--no-deps", "frontend-build", "publish", release)
    # Nginx 重建容器会重新解析后端地址，避免后端换 IP 后保留旧代理地址。
    run("up", "-d", "--no-build", "--no-deps", "--force-recreate",
        "--wait", "--wait-timeout", "180", "frontend")
    STATE.parent.mkdir(exist_ok=True)
    temporary = STATE.with_suffix(".tmp")
    temporary.write_text(json.dumps(current))
    temporary.replace(STATE)
    if build_backend:
        subprocess.run(["make", "docker-prod-trim"], cwd=ROOT, check=True)
    print("生产部署完成；未删除数据库或素材卷。", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", action="store_true")
    parser.add_argument("--rebuild-backend", action="store_true")
    options = parser.parse_args()
    if options.plan:
        deploy(plan=True, rebuild_backend=options.rebuild_backend)
    else:
        if platform.system() != "Linux":
            raise SystemExit("生产发布仅允许在 Linux 部署服务器执行；本地可用 --plan。")
        # 同机并发发布串行执行，避免迁移、静态指针与状态文件互相覆盖。
        import fcntl

        STATE.parent.mkdir(exist_ok=True)
        with (STATE.parent / "lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            deploy(rebuild_backend=options.rebuild_backend)
