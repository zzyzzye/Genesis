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
cp -n .env.development.example .env.development
make docker-dev
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

更新开发环境先通过现有容器执行 `docker compose --env-file .env.development -f compose.yml exec -T backend uv run alembic upgrade head`；生产使用 `make docker-prod` 自动迁移。缓存、版本隔离与恢复规则见 [文章导读说明](docs/article-guides.md)。

## 文章回收站

文章管理中的「回收站」保留已删除文章的正文、分类、标签和评论。编辑器及博客助手的删除操作都会将文章移入回收站，公开列表、正文、评论和 AI 导读不再显示这些文章。恢复后存为草稿，需要手动发布才会重新公开；文章地址在回收站中仍保留占用。

回收站支持搜索、分页、恢复和彻底删除。彻底删除需再次确认，操作不可恢复；独立上传的附件、共享分类和标签会保留。文章不会自动过期清理。该功能仅针对文章，独立页面、评论和附件仍沿用原有删除规则。

## 文章内容导出

文章列表每行的下载图标可导出该篇文章的 Markdown；顶部「导出全部」下载所有已保存的草稿和已发布文章 ZIP，不受搜索、状态筛选或分页影响。回收站提供独立的「导出回收站」及单篇导出，导出不改变文章状态、版本或公开范围。

Markdown 保留原始正文，并通过 YAML front matter 记录标题、摘要、多分类、标签、作者公开资料、封面地址、发布状态和时间。ZIP 内含 `articles/`、带格式版本的 `manifest.json` 和中文说明，文件名附加文章 UUID，避免历史路径或重名导致覆盖。

导出仅限站点所有者，通过现有登录鉴权下载，响应禁止缓存；下载准备期间可取消，失败可重试。文件不包含评论、附件文件、独立页面或账户凭据；图片和附件链接保持原样，迁移时需要另行迁移对应文件。这是文章内容导出，不是完整数据库备份。

文章管理支持导入 `.md`、`.markdown`、普通 ZIP 及 Genesis 导出 ZIP：先预览标题、路径、分类标签与冲突，再确认创建所选草稿。同路径文章（含回收站）不会覆盖；原标识、作者、发布状态、删除状态及定时计划不会恢复。没有元数据的文件会从一级标题和文件名推导标题、地址。文件需为 UTF-8；可使用 YAML front matter 的 `title`、`slug`、`excerpt`、`categories`、`tags`、`cover_image_url` 等字段。每次最多上传 20 个文件、合计 20 MiB；最多 200 篇，单篇最多 2 MiB，展开 Markdown 总量最多 50 MiB。ZIP 只读取 Markdown，不解压到磁盘；不接受加密、符号链接、危险路径或 YAML 别名。

文章列表提供本页选择、全部匹配选择及跨页保留，单批最多 200 篇。可批量发布、撤回、替换分类/标签、定时发布、取消计划、移入回收站、恢复与彻底删除。执行前显示具体文章与后果；服务器锁定整批文章核对版本，任何冲突均整批回滚。导入及批量操作将请求摘要和成功回执与修改一起提交，网络失败后使用同一操作标识重试，不重复创建或执行。

定时发布使用浏览器当前时区选择未来时间，提交时转换为 UTC。计划持久化在 PostgreSQL，后台每 5 秒检查到期草稿，使用行锁避免多个实例重复发布；每轮最多 50 篇，服务停机期间到期的计划会在恢复后补发。列表显示计划时间，可选择一篇或多篇调整/取消；编辑保存草稿保留计划，立即发布、撤回或移入回收站会清除计划。部署需要执行迁移 `20261021_19`（Compose 启动时自动升级）。评论通知本轮未实现。

## 博客 Agent 的文章管理

博客助手可以读取现有分类标签，为新文章或已有文章设置多分类、标签和封面，也支持一次创建并直接发布、一次创建并定时发布，以及调整或取消已有发布计划。已有标签沿用原名称，避免修改单篇文章时意外重命名共享标签。

定时发布需要明确的时间和时区；新文章使用 `create_scheduled_post`，已有文章使用 `schedule_post`，取消计划使用 `cancel_post_schedule`。这几个工具复用文章管理的校验与后台发布任务，保存计划不表示已经公开。文章读取结果包含计划、元数据和更新时间，更新、发布或移入回收站会在提议时及最终执行时核对版本；文章发生变化后需重新读取并核对。

审阅模式只生成操作卡，确认后写入；自动模式由工具执行并展示真实回执。完整写操作成功返回卡片后，本轮生成通过 LangChain 原生中间件结束，避免重复提议；参数错误仍允许模型修正后重试。操作卡展示分类、标签、带时区的计划时间与正文预览，取消计划、立即发布及撤回使用对应的操作名称。

## 博客独立页面

在 `/blog/studio/pages` 创建关于、站点说明和专题页面，支持 Markdown 编辑与预览、草稿保存、发布、撤回和删除。公开目录位于 `/blog/pages`，发布后的正文地址为 `/blog/pages/:slug`；草稿不会公开，也不会混入文章列表。

已有开发环境更新代码后，使用现有后端容器执行 `docker compose --env-file .env.development -f compose.yml exec -T backend uv run alembic upgrade head`；生产使用 `make docker-prod` 自动迁移。

## 博客附件与文件夹

Agent 聊天附件复用私有附件库。图片与视频发送前按内容识别类型，补齐缺失或不一致的文件名后缀，并在标准多模态消息的元数据和用户附件说明中携带文件名；模型适配器仍通过 Base64 与 MIME 类型读取媒体，不依赖公网访问。文档保留原始附件名，解析后的会话文件沿用 `.txt` 后缀。

在 `/blog/studio/attachments` 上传任意类型文件或整个文件夹，支持多级目录、新建空文件夹、搜索分页、重命名、移动、下载和删除。整文件夹上传保留文件的相对层级；浏览器不会返回空子目录，可手动新建补充。同名内容不会覆盖，非空文件夹需先整理内容再删除。

单个文件上限 200 MiB，支持零字节文件。上传队列显示真实传输进度，收到服务端回执后才标记成功；失败可用同一标识重试。停止上传仅停止客户端等待，服务端可能已保存，重试会核对内容并返回已有回执。队列只保存在当前页面内存，刷新或离开需重新选择未完成文件。

附件默认私有，只有作者能下载。确认公开后可复制固定下载链接，重命名、移动不改变链接，撤回公开或删除后链接失效；任意类型均强制下载，不作为网页执行。文件复用现有持久化卷的 `/data/media/blog`，目录为数据库逻辑层级。开发环境更新后在现有后端容器执行 `docker compose --env-file .env.development -f compose.yml exec -T backend uv run alembic upgrade head` 应用迁移；生产使用 `make docker-prod` 自动迁移。

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
make docker-dev    # 读取 .env.development，后台启动开发 / 测试环境
make docker-up     # docker-dev 的兼容别名
make docker-down   # 停止 Docker 开发环境
make docker-logs   # 查看开发环境日志
make docker-check  # 在容器中运行全部检查和测试
make docker-prod   # 读取 .env.production，后台启动生产环境（8090）
make docker-prod-status # 查看生产容器状态
make docker-prod-logs   # 查看生产环境日志
make docker-prod-down   # 停止生产环境，保留数据卷
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

Docker 配置按环境分开，实际配置文件不会进入 Git；启动命令显式指定文件，不再自动读取原来的根目录 `.env`。开发和生产的项目名、数据库与素材卷也保持独立。

| 环境 | Git 中的示例 | 本地 / 服务器实际配置 | 启动命令 | 入口 |
| --- | --- | --- | --- | --- |
| 开发 / 测试 | `.env.development.example` | `.env.development` | `make docker-dev` | 前端 5173、后端 8000 |
| 生产 | `.env.production.example` | `.env.production` | `make docker-prod` | 8090 |

### 开发 / 测试

```bash
cp -n .env.development.example .env.development
# 在 .env.development 中填写需要使用的模型 API Key。
make docker-dev
```

开发示例使用明确标注的本地签名值和示例账号密码，不用于公网部署。数据库连接使用开发 Compose 默认配置。

### 生产部署（1Panel / 云服务器）

```bash
cp -n .env.production.example .env.production
# 先填写下述三项必填配置和需要使用的模型 API Key，再启动。
chmod 600 .env.production
make docker-prod
```

生产示例的 `GENESIS_POSTGRES_PASSWORD`、`GENESIS_JWT_SECRET` 和 `GENESIS_AGENT_ACTION_SECRET` 均留空；未填写时 Compose 会在启动前报出变量名。全新数据库的密码和两个签名密钥应分别生成，`openssl rand -hex 32` 可生成一个随机值。已有生产数据库必须沿用其当前数据库密码，修改配置文件本身不会修改数据库内的密码。生产环境不自动创建开发账号；首次通过网站注册账号后，再将指定账号授予 owner 权限。

从旧 `.env` 升级时，手动把有效的数据库密码、生产签名密钥和模型配置填入 `.env.production`；本地开发则填写 `.env.development`。旧文件保留但不再作为这些命令的配置来源，不自动复制密钥，也不要用示例覆盖已有实际配置。修改生产模型配置后重新执行启动命令即可应用；数据库迁移会先于后端启动。

不使用 Make 时，两种启动命令分别为：

```bash
# 开发 / 测试
docker compose --env-file .env.development -f compose.yml up -d --build

# 生产；只使用 compose.prod.yml，不与开发 Compose 合并。
docker compose --env-file .env.production -f compose.prod.yml up -d --build

# 生产状态和迁移日志
docker compose --env-file .env.production -f compose.prod.yml ps
docker compose --env-file .env.production -f compose.prod.yml logs --tail 80 migrate
```

1Panel OpenResty 可继续代理到 `http://127.0.0.1:8090`，沿用原有域名和 HTTPS。`GENESIS_VIDEO_PUBLIC_BASE_URL` 应填写实际公网 HTTPS 地址；外部代理的上传大小需容纳 201 MiB 请求体。

文本生成通过 `GENESIS_TEXT_PROVIDER` 选择 `openai`、`grok`、`gemini`、`claude` 或 `mimo`，并填写对应的 API Key 和模型名。生图、生视频配置见下文。

后端已预留 LangChain、LangGraph、Deep Agents 依赖，并提供站点所有者权限的动态模型发现接口：GET /api/v1/llm/providers/{provider}/models。模型名称会根据配置的 URL 和 API Key 从供应商接口获取，对应环境配置中的模型名仅作为自定义网关不可发现时的 fallback。

如果临时脱离 Docker 运行服务，再分别复制后端和前端示例文件：

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

前端开发服务器会将 `/api` 请求代理到 `http://localhost:8000`。

# 工具箱命名

工具箱业务系统统一使用 `toolbox`：前端源码位于 `frontend/src/pages/toolbox/`，后端业务模块位于 `backend/src/genesis_api/toolbox/`，页面路径为 `/toolbox`，健康检查为 `/api/v1/toolbox/health`，AI 请求的 `surface` 和 `context.module` 均使用 `toolbox`。旧前端 `/tools/*` 链接会跳转到对应的新路径，并保留查询参数与锚点。

Agent 的 `tools.py`、工具列表 `tools` 与第三方框架工具 API 保留原名，表示可调用能力，不表示业务系统。

## 图片与视频生成（云影 API）

### 图片生成

生图节点接入[云影 OpenAI Images 兼容接口](https://ai-document.yyapi.cloud/zh/image-api)。在对应环境配置中自行填写 `GENESIS_IMAGE_API_KEY`，`GENESIS_IMAGE_API_BASE_URL` 默认 `https://zl.yyapi.cloud`。开发环境配置后运行 `docker compose --env-file .env.development -f compose.yml up -d --no-deps backend`；生产环境运行 `make docker-prod`，先完成迁移再启动。不要将 Key 写入源码或发到聊天。

模型完整读取当前图片 Key 的实时 `/v1/models`，不按文档白名单隐藏新模型。文生图提交 JSON；文档明确支持编辑的模型可使用图生图，服务端直接上传本地图片，无需部署公网地址。生图编辑区的「上传」「作品素材」建立图片参考节点与连线，并切换为图生图；画布中的图片节点也可手动连入。生成结果预览与参考图片相互独立。

图片尺寸留空使用模型默认，也可填写如 `1024x1024`；尺寸和多图数量是否可用由所选模型决定，不沿用视频的 720P/比例参数。支持 1、2、4 张请求，兼容 URL 与 Base64 结果；全部结果保存为当前作品的私有素材。点击结果缩略图仅切换预览，不改写提示词。任务请求携带 `Idempotency-Key`，本地标识同时防止连续点击、断网重试重复调用；结果未知需先核实服务商记录。结果保存失败可重试保存已有响应，不重新生成。未完成任务阻止删除作品，重启仅恢复已缓存结果，不自动重放付费请求。

### 视频配置与使用

生视频节点接入[云影 OpenAI Videos 兼容接口](https://ai-document.yyapi.cloud/zh/video-api)。在项目根目录的本地配置中自行填写 `GENESIS_VIDEO_API_KEY`；不要将 Key 写入源码或发到聊天。Compose 也兼容根配置中的 `VIDEO_API_KEY`，优先使用带 GENESIS 前缀的配置。`GENESIS_VIDEO_API_BASE_URL` 默认是 `https://zl.yyapi.cloud`，不需要附加 `/v1`。

修改配置后，通过现有 Compose 服务应用配置和数据库迁移：

```bash
docker compose --env-file .env.development -f compose.yml up -d --no-deps backend
docker compose --env-file .env.development -f compose.yml exec -T backend uv run alembic upgrade head
```

模型名完整展示实时 `/v1/models` 目录，不以本地参数表筛除新模型。已验证参数的模型支持调整比例、清晰度和时长；未声明参数范围的模型仅提交 `model` 和 `prompt`，使用服务商默认画幅、清晰度和时长，暂不发送参考素材。服务端仍验证模型在实时目录中，每次生成一个视频。文档未明确模型声音开关能力，因此省略 `generate_audio`，声音沿用模型默认。保存节点只保存草稿；点击「生成视频」才创建任务。

镜头搭档的图片、视频模型查询工具会附带供应商模型广场的 `description` 简介，复用现有控制台认证和十二小时目录缓存，仅向模型传递匹配的简介，不传价格、分组或凭据。简介查询不依赖令牌列表、货币口径或价格同步成功；查询失败或内容缺失时保留可用模型并省略简介。助手按简介明确描述的参考种类与总数规划，不猜测缩写和缺失限制；视频时长等本地文档快照会单独标注来源，简介与快照冲突时不绕过提交校验。

服务端保存公开任务 ID，每 15 秒查询状态；页面刷新或服务重启继续查询已有任务。完成后将视频保存为当前作品的私有素材，点击「使用生成结果」应用到节点预览，不覆盖正在编辑的提示词。创建请求超时或结果未知时不自动重提；必须核实供应商任务后才能重新提交，避免重复扣费。视频保存失败可单独「重试保存视频」，不会重新生成；供应商下载链接约 24 小时有效。

参考素材取生视频节点的直接连入素材，按连线顺序传递。当前本地环境保留 `GENESIS_VIDEO_PUBLIC_BASE_URL` 为空，文生视频可独立使用；参考模式会明确提示需要公网部署。待 `https://serenova.cn` 部署完成、可从公网访问 `/api/v1/media/video-references/` 后，再设置 `GENESIS_VIDEO_PUBLIC_BASE_URL=https://serenova.cn` 并通过 Compose 应用。素材按任务签发两小时读取链接，不改变账户素材的私有状态；提交前先检查公网 GET 和媒体类型。自带 Nginx 与后端访问日志不记录这些链接的授权参数，外层反向代理也应过滤该路径的查询串。

视频参考链接在素材 UUID 后按 MIME 类型带上 `.png`、`.jpg`、`.mp4`、`.wav` 等后缀，下载响应同时携带与类型一致的文件名；原有无后缀链接仍兼容，后缀不匹配返回 404，授权仍绑定任务与素材。生图的 multipart 参考文件同样携带规范的原文件名和后缀。存储仍使用私有 UUID 文件，不需要移动已有素材或执行数据库迁移。

### 钱包与免费 SVG

登录用户可使用影音助手与生成工具。MiMo 和 `/toolbox/svg` 免费；YYAPI 付费模型直接创建任务，不预先冻结余额，按上游实账结算；结算余额不足时保留待处理账单。钱包位于 `/account/wallet`，站长在 `/account/billing` 人工入账和审核价格，新用户不赠送付费额度。上线先执行账务迁移 `20261028_30`，以追加流水方式退回历史冻结；不再要求逐模型最高费用审核；额度换算从渠道状态核验，口径未知的账单保留待核对。详见 [账务规则与发布步骤](docs/billing.md)。
