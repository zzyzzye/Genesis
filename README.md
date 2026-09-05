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
