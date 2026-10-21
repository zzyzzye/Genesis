# Genesis

Genesis 是一个工程化的前后端 Monorepo：

- `frontend/`：React、TypeScript、Vite
- `backend/`：FastAPI、Pydantic、uv

## 环境要求

- Node.js 22+
- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- GNU Make（macOS 与大多数 Linux 发行版默认提供）

## 快速开始

推荐使用 Docker 开发，本地只需要保留源码、配置和锁文件：

```bash
make docker-up
```

首次启动会构建镜像，后续修改 React 或 FastAPI 源码时会自动热更新。

停止服务：

```bash
make docker-down
```

默认地址：

- 前端：http://localhost:5173
- 后端：http://localhost:8000
- API 文档：http://localhost:8000/docs

## 文章 AI 导读

公开文章的摘要与正文之间提供默认收起的「AI 导读」，展开查看三个要点和阅读重点。发布或更新文章后，后端复用站点默认文本模型生成当前版本的缓存；旧文章会逐批补齐，读者展开和重试只读取缓存。模型未配置、生成失败或正文超过 60,000 字符时仍可直接阅读正文，作者再次保存已发布文章可重试生成。

更新环境先通过现有容器执行 `docker compose exec -T backend uv run alembic upgrade head`。缓存、版本隔离与恢复规则见 [文章导读说明](docs/article-guides.md)。

## 文章回收站

文章管理中的「回收站」保留已删除文章的正文、分类、标签和评论。编辑器及博客助手的删除操作都会将文章移入回收站，公开列表、正文、评论和 AI 导读不再显示这些文章。恢复后存为草稿，需要手动发布才会重新公开；文章地址在回收站中仍保留占用。

回收站支持搜索、分页、恢复和彻底删除。彻底删除需再次确认，操作不可恢复；独立上传的附件、共享分类和标签会保留。文章不会自动过期清理。该功能仅针对文章，独立页面、评论和附件仍沿用原有删除规则。

## 博客独立页面

在 `/blog/studio/pages` 创建关于、站点说明和专题页面，支持 Markdown 编辑与预览、草稿保存、发布、撤回和删除。公开目录位于 `/blog/pages`，发布后的正文地址为 `/blog/pages/:slug`；草稿不会公开，也不会混入文章列表。

已有环境更新代码后，使用现有后端容器执行 `docker compose exec -T backend uv run alembic upgrade head`，应用独立页面数据表迁移。

## 博客附件与文件夹

在 `/blog/studio/attachments` 上传任意类型文件或整个文件夹，支持多级目录、新建空文件夹、搜索分页、重命名、移动、下载和删除。整文件夹上传保留文件的相对层级；浏览器不会返回空子目录，可手动新建补充。同名内容不会覆盖，非空文件夹需先整理内容再删除。

单个文件上限 200 MiB，支持零字节文件。上传队列显示真实传输进度，收到服务端回执后才标记成功；失败可用同一标识重试。停止上传仅停止客户端等待，服务端可能已保存，重试会核对内容并返回已有回执。队列只保存在当前页面内存，刷新或离开需重新选择未完成文件。

附件默认私有，只有作者能下载。确认公开后可复制固定下载链接，重命名、移动不改变链接，撤回公开或删除后链接失效；任意类型均强制下载，不作为网页执行。文件复用现有持久化卷的 `/data/media/blog`，目录为数据库逻辑层级。更新代码后在现有后端容器执行 `docker compose exec -T backend uv run alembic upgrade head` 应用迁移。

文章和独立页面编辑器的正文工具栏提供「插入附件」，富文本与源码模式均可使用。可浏览附件库文件夹、搜索当前目录、分页选择已有文件，或直接上传任意类型文件到当前目录；上传失败、停止后可沿用同一标识重试核对结果。上传成功先选中，点击插入才进入下一步。

私有附件插入前需确认公开，附件立即对持有链接的人可见，即使正文仍为草稿。服务端按文件签名识别 PNG、JPEG、GIF、WebP 和 AVIF，图片使用独立的 `/api/v1/blog/attachments/{id}/image` 地址内嵌，其他文件插入固定下载链接。SVG、HTML 等在正文只提供下载链接。两种地址都受公开状态控制，撤回公开会使正文图片或下载失效。插入保留光标位置与编辑器撤销历史，取消选择不会删除已上传的文件。

附件管理和编辑器选择器均提供图片缩略图与「预览」。可查看图片、PDF、浏览器支持的常见音视频和 UTF-8 文本；未知格式提示下载。预览使用作者鉴权，不会自动公开文件。列表按需读取 8 MiB 以内图片；手动媒体预览上限 64 MiB，文本显示前 256 KiB，HTML/SVG 仅显示纯文本。关闭预览取消请求并释放临时地址，加载失败可重试；编辑器返回列表保留已选附件，插入时仍需确认公开。

## 常用命令

```bash
make install       # 安装前后端依赖
make dev-frontend  # 启动前端开发服务器
make dev-backend   # 启动后端开发服务器
make lint          # 检查前后端代码规范
make test          # 运行前后端测试
make build         # 构建前端并检查后端包
make check         # 依次执行 lint、test、build
make docker-up     # 构建并启动 Docker 开发环境
make docker-down   # 停止 Docker 开发环境
make docker-check  # 在容器中运行全部检查和测试
make docker-prod   # 构建并启动生产镜像（端口 8080）
```

## 目录结构

```text
.
├── backend/
│   ├── src/genesis_api/
│   │   ├── api/routes/
│   │   ├── core/
│   │   └── main.py
│   └── tests/
├── frontend/
│   ├── src/
│   └── tests/
├── .github/workflows/ci.yml
├── AGENTS.md
└── Makefile
```

## Docker 开发

开发环境包含两个容器：

- `frontend`：Vite 开发服务器，支持 HMR
- `backend`：FastAPI 开发服务器，支持自动重载

本地源码通过 bind mount 挂载到容器。前端 `node_modules` 使用 Docker volume，后端 Python 环境直接包含在镜像中，因此宿主机不需要维护依赖目录。修改依赖锁文件后，重新执行 `make docker-up` 构建镜像。

Docker 可能会在宿主机创建一个空的 `frontend/node_modules/` 挂载点；实际依赖保存在名为 `genesis_frontend_node_modules` 的 Docker volume 中，该空目录不包含本地依赖。

基础镜像和 Python 包默认通过国内镜像源获取，以缩短首次构建时间。

生产镜像使用多阶段构建：React 静态文件由 Nginx 提供，`/api` 请求反向代理到以非 root 用户运行的 FastAPI 容器。

## 本地运行（可选）

如果临时需要脱离 Docker 调试：

```bash
make install
make dev-backend
make dev-frontend
```

## 配置

本地配置文件不会进入 Git。使用 Docker 开发时，复制项目根目录的示例文件，文本生成模型的配置会由 Compose 传给后端：

```bash
cp .env.example .env
make docker-up
```

文本生成通过 `GENESIS_TEXT_PROVIDER` 选择 `openai`、`grok` 或 `claude`，并分别填写对应的 API Key 和模型名。图像生成、视频生成配置将在后续阶段补充。

后端已预留 LangChain、LangGraph、Deep Agents 依赖，并提供站点所有者权限的动态模型发现接口：GET /api/v1/llm/providers/{provider}/models。模型名称会根据配置的 URL 和 API Key 从供应商接口获取，.env 中的模型名仅作为自定义网关不可发现时的 fallback。

如果临时脱离 Docker 运行服务，再分别复制后端和前端示例文件：

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

前端开发服务器会将 `/api` 请求代理到 `http://localhost:8000`。

# 工具箱命名

工具箱业务系统统一使用 `toolbox`：前端源码位于 `frontend/src/pages/toolbox/`，后端业务模块位于 `backend/src/genesis_api/toolbox/`，页面路径为 `/toolbox`，健康检查为 `/api/v1/toolbox/health`，AI 请求的 `surface` 和 `context.module` 均使用 `toolbox`。旧前端 `/tools/*` 链接会跳转到对应的新路径，并保留查询参数与锚点。

Agent 的 `tools.py`、工具列表 `tools` 与第三方框架工具 API 保留原名，表示可调用能力，不表示业务系统。
