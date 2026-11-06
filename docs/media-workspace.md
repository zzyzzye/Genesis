# 影音创作空间

入口为 `/media`。登录后创建作品，先进入作品页 `/media/projects/:id`；账户素材库位于 `/media/assets`，作品素材管理位于独立页面 `/media/projects/:id/assets`，画布位于 `/media/projects/:id/canvas`。
作品和素材属于当前账户，普通成员也可使用；没有公开素材链接或跨账户协作。

## 素材归属

- 作品内上传默认只关联当前作品；“加入账户库”只改变素材归属，不复制文件。
- 账户素材可以引用到多个作品，作品间共享同一底层文件。
- 作品素材库是独立页面。可从作品页或画布进入；选择“放入画布”后创建作品引用并在画布中生成节点。
- 删除画布节点保留素材；移出作品会同时移除相关节点。
- 账户素材仍有作品引用时拒绝删除并返回作品名称。删除作品只清理不再被引用、且未加入账户库的文件。
- 冲突另存作品时，通过复制素材引用保留作品私有文件，不隐式加入账户库。

## 画布保存

前端无限画布使用 `@xyflow/react`。React Flow 只负责视口、选择、拖动和尺寸调整，后端仍持久化 Genesis 自有的节点与视口文档，不保存库的内部状态。
停止编辑约 700ms 后保存到 PostgreSQL。保存请求携带版本号，后端锁定作品行并校验版本。
冲突返回 409，前端停止覆盖，允许重新加载或将本地内容保存为新作品。
未保存文档暂存于浏览器，键包含账户和作品 ID；服务器确认保存后删除暂存。
撤销重做仅保留当前会话最近 60 次操作，重新打开后不恢复操作历史。

## 文件存储与部署

开发和生产 Compose 均挂载 `media_data` 到后端 `/data/media`，生产用户 UID 为 10001。
文件采用 UUID 命名，原始名称仅用于元数据和下载响应。API 文件读取需要账户 Bearer 身份认证。
单文件上限为 200 MiB，生产代理允许 201 MiB 请求体以容纳 multipart 头部。
使用浏览器原生图片、视频和音频预览，不提供转码；无法预览时可下载原文件。
前端通过鉴权请求获取 Blob，预览加载完整文件，因此大型视频首次打开需要等待下载完成。

备份和恢复需要同时覆盖 PostgreSQL 与 `media_data` 卷。当前为单后端实例部署。
迁移版本：`20260923_07`；不需要迁移旧模拟素材。

## 接口

所有接口位于 `/api/v1/media`。

- `projects`：查询、创建；`projects/{id}`：详情、改名、删除。
- `projects/{id}/canvas`：读取、带版本号更新。
- `assets`：账户素材分页查询和上传；`assets/{id}`：详情、删除。
- `assets/{id}/file`：鉴权文件下载，支持 Range；`assets/{id}/library`：加入账户库。
- `projects/{id}/assets`：作品素材分页查询和上传。
- `projects/{id}/assets/reference`：引用账户素材；`projects/{id}/assets/{assetId}`：移出作品。
- `projects/{id}/copy-assets/{targetId}`：同一账户作品间复制指定素材引用，供冲突另存使用。

## 图片模型协议

图片渠道共用模型目录与计费配置，提交时按模型区分协议：

- GPT Image、Imagen 等模型沿用 OpenAI Images 接口：文生图走 `/v1/images/generations`，有显式图片引用时走 `/v1/images/edits`。
- Grok Imagine Image 系列使用 JSON Images 协议：无参考时走 `/v1/images/generations`；单图编辑使用 `/v1/images/edits` 的 `image` 对象，多图使用 `images` 数组，不发送 multipart。参考图片使用本地文件的 base64 data URI，去重后最多 5 张，仍须连线且在提示词中 `@` 引用。尺寸映射到 `aspect_ratio`、小写 `resolution`（1k/2k）；4K、透明背景及不支持的比例在计费前拒绝，不静默降级。完整渠道别名保持原样。
- Nano Banana 和 Gemini Image 系列走 `/v1beta/models/{完整公开模型名}:generateContent`。例如 `[AS专线] nano-banana-2.1`，保留渠道前缀并进行 URL 编码，不自行改写成另一个上游型号。参考图以本地图片的 `inlineData` 发送，仍必须同时连线且在提示词中 `@` 引用。
- 原生请求使用 `generationConfig.responseModalities`，比例和清晰度映射到 `imageConfig.aspectRatio`、`imageSize`；数量映射到 `candidateCount`，是否支持多候选由上游模型决定，不拆分为多次生成请求。原生接口没有透明背景字段，选择透明背景时在提交前提示调整。
- 原生响应只提取最终图片，忽略文字和思考图片，随后复用私有素材入库、结果缓存与恢复流程。失败或结果未知时不自动切换协议重发，保持每个任务一次上游调用与既有账务归属。

协议依据：[云影 Images 文档](https://ai-document.yyapi.cloud/zh/image-api)、[Google generateContent 参考](https://ai.google.dev/api/generate-content)、[New API Gemini 适配器](https://github.com/QuantumNous/new-api/blob/main/relay/channel/gemini/adaptor.go)。2026-11-06 经 7897 代理查询[服务商公开模型目录](https://www.yyapi.cloud/api/pricing)，`[AS专线] nano-banana-2.1` 声明支持 `gemini`、`openai`（聊天），未声明 `image-generation`。文档中的 Images 模型名单不作为全渠道生图模型白名单；具体专线别名的在线生成仍需上线后验证。

本次复用 Compose 后端完成 656 项全量测试，覆盖率 91.40%；相关文件 Ruff、格式检查及 `src/tests` 全库 mypy 通过。图片协议回归覆盖专线别名、默认与指定尺寸、连线且艾特的本地参考、Grok 单图/多图 JSON 与参考去重、超限参数在计费前拒绝、最终图片入库、幂等和单次账务记录、失败不切换协议重发。响应均为合成数据，未使用真实 Key 或发起付费生成。

Grok 协议依据：[xAI 图片生成](https://docs.x.ai/developers/model-capabilities/images/generation)、[单图编辑示例](https://docs.x.ai/developers/model-capabilities/images/prompting-guide)、[多图编辑](https://docs.x.ai/developers/model-capabilities/images/multi-image-editing)。云影公开目录目前仅为 `grok-imagine-image-2.0` 标记聊天/Responses 能力；本地协议适配与合成响应回归不能证明其网关已完整透传图片编辑字段，部署后仍需验证实际渠道。不会在失败后自动改走聊天协议重复提交付费请求。

## 本轮验证记录

- 前端 ESLint、TypeScript、26 项测试及生产构建通过；构建仍有大包体积警告。
- 后端本次代码及 `src/tests` Ruff、mypy、58 项测试通过，整体测试覆盖率 91.46%；全库 Ruff 的两处旧迁移文件问题未在本功能中修改。
- Alembic 升级成功；Compose 三个服务健康。容器重建前后，画布版本、节点数以及测试素材 SHA-256 一致。
- 本次 React Flow 迁移使用已运行的 Compose 前端，在 Chrome 中覆盖创建临时作品、便签编辑、拖动、尺寸调整、视口缩放、刷新恢复、上传图片并加入画布、图片预览，以及 390px 窄屏“适应全部”；桌面和窄屏截图均确认没有画布遮挡或横向溢出。验收作品和素材已删除。更早版本覆盖过登录返回、真实版本冲突及另存作品。
- 图片与视频首帧预览通过。内置验收浏览器点击原生音视频播放时崩溃，播放验收等待用户在日常浏览器确认；按用户要求先提交推送，保留此待验收项。
- 仅用于本轮验收的临时账户、作品和上传文件已清理，不影响用户数据。
