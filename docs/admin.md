# 全站管理

`/admin` 为站长专用后台，普通成员由前端显示权限页，所有管理 API 再通过
`OwnerDependency` 校验数据库中的站长身份。账户侧栏提供入口，原
`/account/billing` 跳转到 `/admin/billing`。

## 页面与数据

- 总览：资源趋势、容器占用、用户数量、近 24 小时任务及待核对账务。
- 服务器：CPU、内存、可写磁盘最高占用率、主机网络、负载、Swap 与磁盘读写趋势；各 CPU 核心和挂载盘容量明细。
- 服务与容器：按内存排序的 CPU、内存、网络、磁盘读写和当前运行时长。
- 服务器的「进程占用」：PID、进程名、CPU、RSS 内存、线程、状态与运行时长；按 CPU 或内存排序，每页 20 条。
- 服务与容器的「系统服务」：systemd 已加载服务的活动、失败、未活动状态，以及自动重启计数和活动时长。
- 用户：账号与昵称搜索、角色、余额、注册时间、关联任务；不读取认证凭据。
- 业务：文章、作品、素材与累计 AI 任务，跳转现有工作台。
- 任务：聊天、图片、视频任务的元数据；按业务、状态、用户分页筛选。
- 账务：复用 `WalletPage`、既有账务 API、确认与幂等机制。

用户和任务查询每页 20 条、服务端过滤，超出页码自动收敛。任务不返回聊天正文、
提示词、画布、生成快照或未经脱敏的上游错误。旧媒体任务未存完成时间，耗时显示
“—”；浏览器本地图片工具没有服务端任务，不能计入任务量。

曲线采用 ECharts SVG，支持悬停或方向键查看采样时间与数值；缺失区间保持断线。
总览主图可切换 CPU、内存、磁盘或网络，默认以同一坐标轴比较网络收发。
内存与磁盘同时显示占用百分比、已用/总容量和占用条。进程内存百分比以所属宿主
内存为基准；容器以其 Linux 采集环境内存为基准并明确标注，不表示容器限制额度。
未知容量保持“—”。

## 监控接入

### macOS 实际宿主机

Docker Desktop 的 Linux 内核不能读取物理 Mac 的全部资源。本地使用
`scripts/native-host-monitor.py` 在 macOS 上采集，通过只读共享文件传给 Docker；
不是额外的 HTTP 服务，不开放新端口，也不修改前后端端口。

```sh
uv run --script scripts/native-host-monitor.py --install
docker compose --env-file .env.development -f compose.yml -f compose.monitoring.yml up -d --no-deps --no-build backend node-exporter
```

安装器创建当前用户的 `cn.serenova.genesis.host-monitor` LaunchAgent，登录后自动运行，
单实例锁避免重复采集，不使用 root。停止时执行
`launchctl bootout gui/$(id -u)/cn.serenova.genesis.host-monitor`，如需取消下次登录启动，
再删除 `~/Library/LaunchAgents/cn.serenova.genesis.host-monitor.plist`。
停止后页面显示宿主离线；仅在明确要恢复 Linux 采集环境时移除
`monitoring/runtime/snapshot.json`，不会自动回退。

采集复用 [psutil 7.2.2](https://psutil.readthedocs.io/stable/) 原生接口，每 5 秒原子更新
`monitoring/runtime/snapshot.json`（0600）和 `native.prom`（0644）。运行目录忽略提交，
不能复制到其他服务器。JSON 只给后台读取，Prometheus 通过 node_exporter textfile
采集不含标签的 `genesis_host_*` 数值；不把进程名写入历史库。
CPU/GPU 名称分别读取固定 sysctl 字段和 system_profiler 显示设备型号，每 5 分钟更新，
不保存序列号、UUID、显示器详情、启动参数或环境变量。

内存以 macOS 可用内存计算；磁盘展示启动盘的数据卷，避免 APFS 多挂载重复统计；
网络汇总 `en*` 接口，不合计回环、隧道和桥接接口。磁盘读写为系统累计计数的差分。
进程展示当前用户有权限读取的资源字段，权限不足和已退出的进程会计入跳过数量。
macOS 不展示 Linux systemd 服务；本版本不提供 launchd 服务清单或 GPU 使用率。

页面明确标注「macOS 宿主机」，资源曲线、核心、容量和进程来自原生采集；容器仍来自
cAdvisor，其内存百分比以 Docker Linux 虚拟机内存为分母，单独标注。历史从接入时开始，
不拼接之前的虚拟机数据。快照超过 30 秒或损坏时显示离线，禁止自动回退到虚拟机；
PromQL 按采集时间过滤过期 textfile 数据，避免把最后一次读数伪装成持续采样。

### Linux / Docker 采集环境

监控使用官方 Prometheus、node_exporter 与 cAdvisor 镜像，无本地构建。
Compose 叠加文件不改变现有服务、网络或端口，不向宿主发布监控端口。
Prometheus 地址固定为内网 `http://prometheus:9090`，后端只允许固定查询，
不提供任意 URL 或 PromQL 代理；浏览器只能通过站长鉴权接口读取安全投影。

开发环境：

```sh
docker compose -f compose.yml -f compose.monitoring.yml up -d --no-build prometheus node-exporter node-network cadvisor host-processes
```

生产 Linux 服务器：

```sh
docker compose -f compose.prod.yml -f compose.monitoring.yml --profile host-services up -d --no-build prometheus node-exporter node-network cadvisor host-processes node-systemd
```

部署应用代码沿用项目已有生产发布流程；上述命令只增加监控服务，不构建或重启业务。
已有 Prometheus 需在采集配置更新后单独重启。`host-services` 只用于使用 systemd 的 Linux
服务器，要求存在 `/run/dbus/system_bus_socket`；非 systemd 主机省略该 profile 和
`node-systemd`。绑定路径不存在时直接失败，不会创建假的 socket 目录。
Prometheus 每 30 秒采集，历史保留上限为 7 天或 2 GB（先达到者生效）。
首次启动要等待至少两次采样才能产生速率；没有历史的时间段不补造数据。
网页每 30 秒刷新，标签页隐藏时停止轮询；单次上游请求超时为 5 秒。

`node-exporter` 只启用 CPU、内存、负载、文件系统和磁盘采集。网络使用第二个
相同镜像 `node-network`，只开启 netdev，关闭默认 netlink，读取宿主
`/proc/1/net/dev`；无需让采集器占用宿主网络，也不会采到自身容器的网络命名空间。
网络汇总排除回环与 Docker 虚拟接口。cAdvisor 只保留容器资源指标，不存容器
自定义标签；所需 Docker socket 挂载仅给采集器，业务后端不挂载 socket。
Docker 29 的 containerd 存储通过宿主根挂载中的 `/run/containerd/containerd.sock`
读取资源元数据；非默认 containerd 地址需按服务器实际位置调整采集器参数。

进程采集使用独立 `host-processes`，只读挂载宿主 `/proc`，采用宿主 cgroup 命名空间。
只读取 `uptime`、PID 1 的 `comm`、每个 PID 的 `stat` 和 `cgroup`；不读取 `cmdline`、
`environ`、文件描述符目标、日志或用户文件。现有 [process-exporter 会读取命令行](https://github.com/ncabatoff/process-exporter/blob/master/proc/read.go)，
因此这里使用最小标准库采集器，保留固定快照端点，不提供命令执行或任意路径接口。
每 5 秒采集，CPU 按 PID + 启动时刻的差分计算；首次样本、PID 复用均保持未知。
瞬时快照不写入历史库，最多 20,000 个进程，截断和读取失败数量会提示；30 秒前的
快照视为不可用。Docker、Kubernetes、Podman、LXC 按资源组标记识别为隔离进程，
其他进程归为宿主，无法读取资源组的进程归为未知；自定义容器资源组可能无法识别。

硬件名称复用 `host-processes` 的独立 `/hardware` 快照，每 60 秒读取一次，超过
180 秒的快照不展示。采集器新增只读 `/sys:/host/sys` 挂载；更新后仅需用上述
Compose 组合执行 `up -d --no-deps --no-build host-processes`，无需构建镜像。
CPU 只提取 `/proc/cpuinfo` 的 `model name` / `Hardware` 字段；GPU 枚举
[PCI 显示设备](https://kernel.org/doc/html/v5.12/PCI/sysfs-pci.html)，优先读取
[NVIDIA 驱动 Model 字段](https://download.nvidia.com/XFree86/Linux-x86_64/435.21/README/procinterface.html)
或设备 `product_name`。没有型号时只显示厂商和 PCI ID，不把设备 ID 当成型号。
不输出 CPU 序列号、GPU UUID 或原始硬件信息；不采集 GPU 占用率。
CPU 未提供型号、GPU 未检测到、SoC 显示设备型号未知和采集失败分别显示。
此信息仍属于当前 Linux 主机可见范围，Docker Desktop 不保证暴露物理 CPU 型号，
未透传的 GPU 不可见；“未检测到可见 GPU”不等于物理机没有显卡。

系统服务复用官方 [node_exporter systemd collector](https://github.com/prometheus/node_exporter/blob/v1.10.2/collector/systemd_linux.go)，使用非 root 用户连接宿主 D-Bus。
仅接收 `.service` 单元，不读取服务环境配置，不提供启停按钮。服务采集失败时不沿用
旧的正常状态；不是 systemd 的主机明确显示不支持。只展示 systemd 已加载单元，
不等于全部已安装服务；活动状态不保证 HTTP、数据库等业务健康。
自动重启计数为 systemd `Restart` 触发次数，不含手动重启，也不是历史累计故障次数。

## 统计边界

- 未启用原生宿主任务时，Docker Desktop 的 Linux 指标属于虚拟机，页面标注「Linux / Docker 采集环境」。接入原生任务后，总览与服务器资源切换到实际 macOS，容器保持单独口径。
- 磁盘概况取可写文件系统的最高占用率，排除内存、overlay、镜像和光盘文件系统。
  详情列出各挂载点容量；同一文件系统可能挂载多处，不能将容量相加。
- 容器 CPU 100% 表示使用一个逻辑核心，可能超过 100%；主机 CPU 为整体利用率。
- 容器内存为 working set，主机内存以 MemAvailable 计算，两者口径不同。
- 进程内存为 RSS，进程之间可能共享页面，不能相加视为主机总占用；进程 CPU 100% 为一核。
- 采集可达不等于应用健康。第一版不宣称 Docker healthcheck 状态或精确重启次数，
  不提供重启容器、删除文件或清理磁盘等写操作。
- 采集缺失、失败和非有限样本显示未知，不显示为 0。运行时长基于当前启动时间，
  不代表历史总在线时长。

参考：[Prometheus API](https://prometheus.io/docs/prometheus/latest/querying/api/)、
[cAdvisor 接入](https://prometheus.io/docs/guides/cadvisor/)、
[node_exporter netdev 实现](https://github.com/prometheus/node_exporter/blob/v1.10.2/collector/netdev_linux.go)。
