"""用假命令验证发布决策与失败边界，不执行 Docker 或任何构建。"""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "deployment", Path(__file__).resolve().parents[1] / "deploy-production.py"
)
assert spec is not None and spec.loader is not None
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


class DeployTests(unittest.TestCase):
    """只检查命令编排，不接触真实生产配置或容器。"""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = Path(self.directory.name) / "state.json"
        self.old = {"dependencies": "deps", "backend": "code", "frontend": "ui"}
        self.state.write_text(json.dumps(self.old))

    def execute(self, values, *, fail=None, plan=False):
        calls = []

        def fake_run(*args, **kwargs):
            calls.append(args)
            if fail and fail in args:
                raise subprocess.CalledProcessError(1, args)
            return subprocess.CompletedProcess(args, 0)

        with (
            patch.object(deployment, "STATE", self.state),
            patch.object(deployment, "fingerprint", side_effect=values),
            patch.object(deployment.platform, "system", return_value="Linux"),
            patch.object(deployment, "run", side_effect=fake_run),
            patch.object(
                deployment.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)
            ),
        ):
            deployment.deploy(plan=plan)
        return calls

    def test_unchanged_does_not_build_or_force_restart_backend(self):
        calls = self.execute(["deps", "code", "ui"])
        self.assertFalse(any("build" in call for call in calls))
        backend = next(call for call in calls if call[-1] == "backend")
        self.assertNotIn("--force-recreate", backend)

    def test_backend_source_only_restarts(self):
        calls = self.execute(["deps", "new-code", "ui"])
        self.assertFalse(any("build" in call for call in calls))
        self.assertIn("--force-recreate", next(call for call in calls if call[-1] == "backend"))

    def test_dependency_change_builds_only_backend(self):
        calls = self.execute(["new-deps", "code", "ui"])
        self.assertEqual([call for call in calls if call[0] == "build"], [("build", "backend")])

    def test_frontend_uses_temporary_builder_and_publishes_after_backend_health(self):
        calls = self.execute(["deps", "code", "new-ui"])
        self.assertFalse(any(call[0] == "build" for call in calls))
        build = next(i for i, call in enumerate(calls) if "build" in call)
        backend = next(i for i, call in enumerate(calls) if call[-1] == "backend")
        publish = next(i for i, call in enumerate(calls) if "publish" in call)
        self.assertLess(build, backend)
        self.assertLess(backend, publish)
        self.assertEqual(json.loads(self.state.read_text())["frontend"], "new-ui")

    def test_failed_build_does_not_record_success(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.execute(["deps", "code", "new-ui"], fail="build")
        self.assertEqual(json.loads(self.state.read_text()), self.old)

    def test_plan_never_runs_docker(self):
        self.assertEqual(self.execute(["new-deps", "code", "new-ui"], plan=True), [])

    def test_production_includes_monitoring_without_building(self):
        self.assertIn("compose.monitoring.yml", deployment.COMPOSE)
        with patch.object(Path, "is_socket", return_value=False):
            calls = self.execute(["deps", "code", "ui"])
        self.assertEqual(calls[0], ("config", "--quiet"))
        self.assertEqual(list(calls[1][-5:]), deployment.MONITORING_SERVICES)
        self.assertIn("--no-build", calls[1])
        self.assertNotIn("node-systemd", calls[1])

    def test_systemd_enabled_only_with_host_bus(self):
        with patch.object(Path, "is_socket", return_value=True):
            calls = self.execute(["deps", "code", "ui"])
        self.assertEqual(calls[1][-1], "node-systemd")

    def test_failed_monitoring_does_not_record_success(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.execute(["deps", "code", "ui"], fail="prometheus")
        self.assertEqual(json.loads(self.state.read_text()), self.old)

    def test_fingerprint_skips_environment_files(self):
        root = Path(self.directory.name)
        (root / "safe.py").write_text("print('synthetic')")
        # 环境文件故意不存在；误读它就会造成指纹变化或失败。
        with patch.object(deployment, "ROOT", root), patch.object(
            deployment.subprocess, "check_output", return_value=b"safe.py\0.env.production\0"
        ):
            with_env = deployment.fingerprint(["."])
        with patch.object(deployment, "ROOT", root), patch.object(
            deployment.subprocess, "check_output", return_value=b"safe.py\0"
        ):
            self.assertEqual(with_env, deployment.fingerprint(["."]))
