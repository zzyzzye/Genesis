# 全站管理

`/admin` 为站长专用后台，普通成员由前端显示权限页，所有管理 API 再通过
`OwnerDependency` 校验数据库中的站长身份。账户侧栏提供入口，原
`/account/billing` 跳转到 `/admin/billing`。

## 页面与数据

- 总览：资源趋势、容器占用、用户数量、近 24 小时任务及待核对账务。
- 服务器：CPU、内存、可写磁盘最高占用率、主机网络、负载、Swap 与磁盘读写趋势；各 CPU 核心和挂载盘容量明细。
- 服务与容器：按内存排序的 CPU、内存、网络、磁盘读写和当前运行时长。
- 用户：账号与昵称搜索、角色、余额、注册时间、关联任务；不读取认证凭据。
- 业务：文章、作品、素材与累计 AI 任务，跳转现有工作台。
- 任务：聊天、图片、视频任务的元数据；按业务、状态、用户分页筛选。
- 账务：复用 `WalletPage`、既有账务 API、确认与幂等机制。

用户和任务查询每页 20 条、服务端过滤，超出页码自动收敛。任务不返回聊天正文、
提示词、画布、生成快照或未经脱敏的上游错误。旧媒体任务未存完成时间，耗时显示
“—”；浏览器本地图片工具没有服务端任务，不能计入任务量。

## 监控接入

监控使用官方 Prometheus、node_exporter 与 cAdvisor 镜像，无本地构建。
Compose 叠加文件不改变现有服务、网络或端口，不向宿主发布监控端口。
Prometheus 地址固定为内网 `http://prometheus:9090`，后端只允许固定查询，
不提供任意 URL 或 PromQL 代理；浏览器只能通过站长鉴权接口读取安全投影。

开发环境：

```sh
docker compose -f compose.yml -f compose.monitoring.yml up -d --no-build prometheus node-exporter node-network cadvisor
```

生产 Linux 服务器：

```sh
docker compose -f compose.prod.yml -f compose.monitoring.yml up -d --no-build prometheus node-exporter node-network cadvisor
```

部署应用代码沿用项目已有生产发布流程；上述命令只增加监控服务，不构建或重启业务。
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

## 统计边界

- Docker Desktop 上的主机指标属于 Docker Linux 虚拟机，不是 macOS 物理机。
- 磁盘概况取可写文件系统的最高占用率，排除内存、overlay、镜像和光盘文件系统。
  详情列出各挂载点容量；同一文件系统可能挂载多处，不能将容量相加。
- 容器 CPU 100% 表示使用一个逻辑核心，可能超过 100%；主机 CPU 为整体利用率。
- 容器内存为 working set，主机内存以 MemAvailable 计算，两者口径不同。
- 采集可达不等于应用健康。第一版不宣称 Docker healthcheck 状态或精确重启次数，
  不提供重启容器、删除文件或清理磁盘等写操作。
- 采集缺失、失败和非有限样本显示未知，不显示为 0。运行时长基于当前启动时间，
  不代表历史总在线时长。

参考：[Prometheus API](https://prometheus.io/docs/prometheus/latest/querying/api/)、
[cAdvisor 接入](https://prometheus.io/docs/guides/cadvisor/)、
[node_exporter netdev 实现](https://github.com/prometheus/node_exporter/blob/v1.10.2/collector/netdev_linux.go)。
