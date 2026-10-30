/** 使用真实助手组件和 AG-UI 解码链路，API 全部为合成数据，不调用模型。 */
import { createRoot } from 'react-dom/client'
import { useCallback, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import '../../styles/base.css'
import '../../styles/shared.css'
import { BlogAssistant } from '../../src/features/blog/agent/BlogAssistant'
import { MediaAssistant, type MediaCanvasActions, type MediaCanvasPlan } from '../../src/pages/media/MediaAssistant'
import '../../src/pages/media/MediaPage.css'
import { ProjectCanvas } from '../../src/pages/media/ProjectCanvas'
import { defaultGenerationSettings, emptyDocument, type Document } from '../../src/pages/media/api'
import { accountAuthTokenKey, studioAuthTokenKey } from '../../src/lib/auth'

if (!import.meta.env.DEV || !['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('此验收页仅限本地开发环境')
const params = new URLSearchParams(location.search)
const mode = params.get('mode') ?? 'full'
const media = params.get('surface') === 'media'
const token = 'ag-ui-synthetic-review'
const userId = '11111111-1111-4111-8111-111111111111'
// 同源验收页不得覆盖创作者已经登录的会话；所有 API 仍只返回合成数据。
const authKey = media ? accountAuthTokenKey : studioAuthTokenKey
const ownsAuth = localStorage.getItem(authKey) === null
if (ownsAuth) localStorage.setItem(authKey, token)
const sessionKey = media ? `genesis-media-ai-conversation:${userId}` : 'genesis-blog-ai-conversation'
sessionStorage.removeItem(sessionKey)
let runNumber = 0
let connections = 0
let stopped = false
let confirmed = false
let reviewCanvas: Document = emptyDocument()
const generationReview = mode === 'canvas-generate'
const videoReferencesReview = mode === 'canvas-video-references'
const videoUpdateReview = mode === 'canvas-video-update' || mode === 'canvas-video-unavailable' || videoReferencesReview
const canvasReview = mode === 'canvas-images' || mode === 'canvas-image-reference' || generationReview || videoUpdateReview
let generationStatus = 'processing'
addEventListener('genesis-review-image-status',event=>{generationStatus=(event as CustomEvent<string>).detail})
const referenceAsset = {id:'synthetic-image',name:'摊主参考.png',kind:'image',mime_type:'image/png',size:68,in_library:false}
const referenceImages = ['生串上架', '翻烤撒料', '油光滋响', '成品出炉'].map((name, index) => ({ ...referenceAsset, id: `synthetic-reference-${index + 1}`, name: `${name}.png`, kind: 'image' as const }))
if (mode === 'canvas-image-reference') reviewCanvas = {...emptyDocument(),nodes:[
  {id:'synthetic-generator',type:'image_generation',name:'夜市摊主',asset_id:null,text:'同一位摊主在夜市烤串，纪实抓拍。',generation:{...defaultGenerationSettings(),model:'gpt-image-2'},x:80,y:120,width:640,height:402},
  {id:'synthetic-reference',type:'image',name:'摊主参考',asset_id:referenceAsset.id,text:'',x:850,y:120,width:360,height:280},
  {id:'synthetic-pending',type:'image_generation',name:'待生成参考',asset_id:null,text:'基准人物图',x:850,y:500,width:640,height:402},
]}
const imageOperations = ['开摊环境', '备料特写', '炭火烤制', '递餐瞬间', '忙碌间隙'].map(name => ({ action: 'add_image_generation', name, text: `中国城市夜市，一位四十岁左右的烧烤摊主，深色围裙、浅色短袖，暖色灯泡与炭火照明。${name}，纪实抓拍，自然质感，不看镜头、不摆拍。` }))
if (videoUpdateReview) reviewCanvas = { ...emptyDocument(), nodes: [{ id: 'synthetic-video', type: 'video', name: '生视频节点 1', asset_id: null, text: '', duration_seconds: 5, generation: defaultGenerationSettings(), x: 80, y: 120, width: 640, height: 402 }] }
if (videoReferencesReview) reviewCanvas.nodes.push(...referenceImages.map((asset, index) => ({ id: `image-${index + 1}`, type: 'image' as const, name: asset.name, asset_id: asset.id, text: '', x: 850, y: 120 + index * 260, width: 360, height: 203 })))
if(generationReview) reviewCanvas={...emptyDocument(),nodes:imageOperations.slice(0,2).map((item,index)=>({id:`synthetic-generator-${index+1}`,type:'image_generation',name:`0${index+1} ${item.name}`,asset_id:null,text:item.text,x:80,y:120+index*480,width:480,height:302,generation:{...defaultGenerationSettings(),model:'image2.5-flare',image_ratio:'16:9',image_resolution:'1K'}}))}
const nativeFetch = window.fetch.bind(window)
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const proposal = {
  type: 'pending_action', module: 'blog', proposal_id: 'synthetic-proposal', action: 'create_draft',
  payload: { title: 'AG-UI 验收草稿', content_markdown: '合成内容' }, summary: '创建 AG-UI 验收草稿',
  requires_confirmation: true, expires_at: '2099-01-01T00:00:00Z', proposal_token: 'synthetic-proposal-token',
}
const tool = {
  id: 'synthetic-tool', name: generationReview ? 'submit_image_generation' : 'list_posts', label: generationReview ? '提交图片生成' : '读取文章', status: 'succeeded',
  started_at: '2026-10-27T03:00:00Z', duration_ms: 120, input_summary: '无参数',
  result_summary: '返回 2 项结果', parameter_names: [], proposal_id: null,
  ...(generationReview ? {resource:{module:'media',kind:'image_generation',id:'synthetic-image-task',scope_id:'synthetic-project',parent_id:'synthetic-generator-1'}} : {}),
}
const { id: toolId, name: toolName, result_summary: toolSummary, ...toolDetails } = tool
const question = '\n```user-question\n' + JSON.stringify({ id: 'synthetic-question', questions: [{ question: '文章面向谁？', options: [{ label: '入门读者', description: '补充背景', recommended: true }, { label: '专业读者', description: '讨论细节', recommended: false }] }] }) + '\n```'
const metrics = { input_tokens: mode === 'context-missing' ? null : 18000, input_provider: 'mimo', input_model: 'mimo-v2.6-flash', output_tokens: 30, token_source: 'actual', output_seconds: 1, tokens_per_second: 30, first_token_seconds: 0.2, total_seconds: 1.2 }
const billing = { id: 'synthetic-bill', mode: 'free', status: 'settled', charged_amount: '0.00000000', reserved_amount: '0.00000000', currency: 'CNY', provider: 'mimo', kind: 'agent', model: 'mimo-v2.6-flash' }

window.fetch = async (input, init) => {
  const path = new URL(input instanceof Request ? input.url : String(input), location.origin).pathname
  if (!path.startsWith('/api/')) return nativeFetch(input, init)
  const method = init?.method ?? 'GET'
  if (videoReferencesReview) {
    if (path.endsWith('/media/projects/synthetic-project/assets')) return json({ items: referenceImages, total: referenceImages.length })
    const asset = referenceImages.find(item => path.includes(`/assets/${item.id}`))
    if (asset) return path.endsWith('/file') ? new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jbcQAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}}) : json(asset)
  }
  if (canvasReview && path.endsWith('/media/projects/synthetic-project/canvas')) {
    if (method === 'PUT' && typeof init?.body === 'string') reviewCanvas = (JSON.parse(init.body) as { document: Document }).document
    return json({ version: 0, document: reviewCanvas })
  }
  if (canvasReview && path.endsWith('/media/projects/synthetic-project')) return json({ id: 'synthetic-project', name: videoUpdateReview ? '烧烤摊主 · 视频方案验收' : '烧烤摊主 · 生图验收', version: 0 })
  if(generationReview && path.endsWith('/image-generations/synthetic-image-task')) return json({id:'synthetic-image-task',node_id:'synthetic-generator-1',status:generationStatus,progress:0,error:generationStatus==='failed'?'合成错误：图片模型暂不可用':'',asset_id:generationStatus==='completed'?referenceAsset.id:null,asset_ids:generationStatus==='completed'?[referenceAsset.id]:[],generation:reviewCanvas.nodes[0]?.generation})
  if(generationReview && path.endsWith(`/assets/${referenceAsset.id}`)) return json(referenceAsset)
  if (mode === 'canvas-image-reference' && path.endsWith('/media/projects/synthetic-project/assets')) return json({items:[referenceAsset],total:1})
  if ((mode === 'canvas-image-reference' || generationReview) && path.endsWith(`/assets/${referenceAsset.id}/file`)) return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jbcQAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}})
  if (path.endsWith('/image-models')) return json({ configured: true, references_ready:true, models: [
    {id:mode === 'canvas-image-reference' ? 'gpt-image-2' : 'image2.5-flare',description:'支持图片生成与编辑，尺寸和参考数量由供应商校验。',pricing:{status:'available',currency:'CNY',unit:'image',amount:'0.11',tiers:[],note:'价格仅供参考，实际费用以上游账单为准。'}},
    {id:'unknown-image-model'},
  ] })
  if (path.includes('/image-generations')) return json([])
  if (path.endsWith('/video-models')) return json({ configured: true, references_ready: true, models: mode === 'canvas-video-unavailable' ? [] : [
    { id: 'synthetic-fixed-15s', description: '提供 3–10 秒、720p 横竖屏输出；支持首帧、风格图、元素图和 1 个源视频，所有参考素材合计最多 4 项。', pricing: { status:'available',currency:'CNY',unit:'request',amount:'0.55',tiers:[],note:'价格仅供参考，实际费用以上游账单为准。' } },
    { id: 'per-second-model', description: '按实际生成秒数计费。请求参数支持情况由供应商校验。', pricing: { status:'available',currency:'CNY',unit:'second',amount:'0.33',tiers:[],note:'价格仅供参考，实际费用以上游账单为准。' } },
    { id: 'unknown-model' },
  ] })
  if (path.endsWith('/video-generations')) return json([])
  if (path.includes('/llm/providers/')) return json({ models: [{ id: 'mimo-v2.6-flash', name: 'MiMo V2.6 Flash', context_window: 1000000, billing_mode: mode.startsWith('paid') ? 'paid' : 'free' }] })
  if (path.endsWith('/billing/quotes')) return mode === 'paid-error'
    ? json({ detail: '合成报价失败，请稍后重试。' }, 503)
    : json({ id: 'synthetic-quote', mode: mode === 'paid' ? 'paid' : 'free', model: 'mimo-v2.6-flash', reserved_amount: '15.90998400' }, 201)
  if (path.endsWith('/auth/me')) return json({ id: userId, role: 'owner', handle: 'synthetic', display_name: '合成验收账户' })
  if (path.endsWith('/ai/actions/confirm')) { confirmed = true; return json({ action: 'create_draft', status: 'draft', post_id: 'synthetic-post' }) }
  if (path.endsWith('/ai/chat/conversations')) return json(method === 'POST' ? { id: 'synthetic-conversation', title: '新对话', title_source: 'manual' } : [])
  if (path.includes('/ai/chat/conversations/')) return json({ id: 'synthetic-conversation', title: '新对话', title_source: 'manual', messages: [] })
  if (path.endsWith('/ai/chat/runs') && method === 'POST') { if (mode === 'paid-error') return json({ detail: '合成余额不足，请充值后重试。' }, 402); runNumber++; connections = 0; stopped = false; return json({ id: `run-${runNumber}`, status: 'pending' }, 202) }
  if (path.includes('/ai/chat/runs/') && method === 'DELETE') { stopped = true; return new Response(null, { status: 204 }) }
  if (path.endsWith('/stream')) {
    connections++
    const runId = `run-${runNumber}`, messageId = `native-model-${runId}`
    const messageMetadata = { genesis: { run_id: runId } }
    const restore = mode === 'reconnect' || generationReview && params.get('reconnect') === '1'
    const reconnect = restore && connections === 1
    const showTool = generationReview || ['full', 'proposal', 'reconnect', 'reset'].includes(mode)
    const restoredTools = restore && connections > 1
    const snapshotMessages = (content: string, withTools: boolean) => [
      { id: `${runId}:user`, role: 'user', content: '合成验收问题' },
      { id: messageId, role: 'assistant', content, metadata: messageMetadata, toolCalls: withTools ? [{ id: toolId, type: 'function', function: { name: toolName, arguments: '{}' }, metadata: { genesis: toolDetails } }] : [] },
      ...(withTools ? [{ id: `${runId}:tool:${toolId}`, role: 'tool', toolCallId: toolId, content: toolSummary, metadata: { genesis: toolDetails } }] : []),
    ]
    let timer: ReturnType<typeof setTimeout> | undefined
    const body = new ReadableStream({ start(controller) {
      const emit = (data: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`))
      emit({ type: 'RUN_STARTED', threadId: 'synthetic-conversation', runId })
      emit({ type: 'MESSAGES_SNAPSHOT', messages: snapshotMessages(mode === 'reconnect' ? '恢复前正文。' : '', restoredTools) })
      emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant', metadata: messageMetadata })
      emit({ type: 'STATE_SNAPSHOT', snapshot: { genesis: { sequence: 0, metrics: null, billing: null, proposals: [] } } })
      if (mode === 'markdown-stream') emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: '**流式加粗**\n\n1. 第一段镜头\n2. 第二段镜头\n\n```typescript\nconst duration = 15;\n' })
      if (showTool && !restoredTools) {
        emit({ type: 'TOOL_CALL_START', toolCallId: toolId, toolCallName: toolName, parentMessageId: messageId, metadata: { genesis: { ...toolDetails, status: 'running', duration_ms: null } } })
        emit({ type: 'TOOL_CALL_ARGS', toolCallId: toolId, delta: '{}' })
        emit({ type: 'TOOL_CALL_END', toolCallId: toolId })
      }
      timer = setTimeout(() => {
        if (reconnect) { controller.close(); return }
        if (stopped || mode === 'error') { emit({ type: 'RUN_ERROR', message: stopped ? '生成已由用户停止。' : '合成测试：生成失败，可以继续对话。' }); controller.close(); return }
        const content = videoUpdateReview ? '已准备 15 秒视频方案。点击应用后更新现有节点。\n```canvas-plan\n' + JSON.stringify({ title: '夜市烧烤 · 15秒视频生成方案', operations: [...(videoReferencesReview ? referenceImages.map((_, index) => ({ action: 'connect_nodes', source_id: `image-${index + 1}`, target_id: 'synthetic-video' })) : []), { action: 'update_node', node_id: 'synthetic-video', model: 'synthetic-fixed-15s', text: videoReferencesReview ? '0–4秒以@[图片](ref:image-1)开场，4–8秒以@[图片](ref:image-2)撒料，8–12秒以@[图片](ref:image-3)展示油光，12–15秒以@[图片](ref:image-4)收尾。' : '0–5秒生串上架，5–10秒油光滋响，10–15秒成品出炉。', duration_seconds: 15 }] }) + '\n```'
          : generationReview ? '已提交「01 开摊环境」的图片生成，沿用 Image 2.5 Flare、16:9、1K。画布会显示加载状态与生成结果。'
          : mode === 'canvas-images' && runNumber > 1 ? '已准备五个节点的 Image 2.5 Flare、16:9、1K 参数修改方案，不启动生成。\n```canvas-plan\n' + JSON.stringify({ title: '统一设置五个生图节点', project_id: 'synthetic-project', version: 0, operations: reviewCanvas.nodes.filter(node => node.type === 'image_generation').map(node => ({ action: 'update_node', node_id: node.id, generation: { model: 'image2.5-flare', image_ratio: '16:9', image_resolution: '1K' }, expected_generation: { model: node.generation?.model ?? '', mode: node.generation?.mode ?? 'text', image_ratio: node.generation?.image_ratio ?? '', image_resolution: node.generation?.image_resolution ?? '', image_size: node.generation?.image_size ?? '' } })) }) + '\n```'
          : mode === 'canvas-images' ? '已整理五个生图节点，提示词已分别填好，应用后可选择模型生成。\n```canvas-plan\n' + JSON.stringify({ title: '夜市烧烤 · 五张分镜图', operations: imageOperations }) + '\n```'
          : mode.startsWith('canvas-') ? '已规划一个视频节点，镜头节奏写入同一条生成提示词。\n```canvas-plan\n' + JSON.stringify({ title: '城市烧烤街 · 草案', operations: [{ action: 'add_video', name: '城市烧烤街', text: '0–4秒炭火，4–8秒翻烤，8–12秒食客，12–15秒街景。', duration_seconds: mode === 'canvas-invalid' ? 4 : 15, model: 'synthetic-fixed-15s' }] }) + '\n```'
          : mode === 'markdown-stream' ? '```\n\n**输出完成**'
          : mode === 'question' && runNumber === 1 ? '请先确认读者方向。'
          : mode === 'question' ? '已按你的回答继续。' : mode === 'empty' ? '' : 'AG-UI 正文流已完成。'
        if (content) emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: content })
        if (mode === 'question' && runNumber === 1) emit({ type: 'CUSTOM', name: 'genesis.question', value: { content: question } })
        if (showTool && !restoredTools) emit({ type: 'TOOL_CALL_RESULT', toolCallId: toolId, messageId: `${runId}:tool:${toolId}`, role: 'tool', content: toolSummary, metadata: { genesis: toolDetails } })
        if (mode === 'reset') {
          emit({ type: 'TEXT_MESSAGE_END', messageId })
          emit({ type: 'MESSAGES_SNAPSHOT', messages: snapshotMessages('重算后的正文，工具结果仍保留。', true) })
          emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant', metadata: messageMetadata })
        }
        emit({ type: 'STATE_SNAPSHOT', snapshot: { genesis: { sequence: 1, metrics, billing,
          proposals: mode === 'proposal' ? [{ ...proposal, executed: confirmed }] : [],
        } } })
        emit({ type: 'TEXT_MESSAGE_END', messageId })
        emit({ type: 'RUN_FINISHED', threadId: 'synthetic-conversation', runId })
        controller.close()
      }, mode === 'slow' ? 30000 : mode === 'markdown-stream' ? 15000 : 700)
    }, cancel() { clearTimeout(timer) } })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  if (path.includes('/ai/chat/runs/')) return json({ id: `run-${runNumber}`, status: stopped ? 'failed' : 'running', content: '', sequence: 1, error: stopped ? '生成已由用户停止。' : null })
  if (path.includes('/billing/')) return json({ mode: 'free', available: '0.00000000', frozen: '0.00000000', currency: 'CNY' })
  return json({ items: [], total: 0 })
}
addEventListener('pagehide', () => {
  if (ownsAuth && localStorage.getItem(authKey) === token) localStorage.removeItem(authKey)
  sessionStorage.removeItem(sessionKey)
}, { once: true })
export function Review() {
  const [applied, setApplied] = useState(false)
  const [applyCanvas, setApplyCanvas] = useState<((plan: MediaCanvasPlan) => void) | null>(null)
  const [canvasActions,setCanvasActions]=useState<MediaCanvasActions|null>(null)
  const handleApplyChange = useCallback((apply: ((plan: MediaCanvasPlan) => void) | null) => setApplyCanvas(() => apply), [])
  if (media && canvasReview) return <MemoryRouter><div className="media-workspace"><ProjectCanvas projectId="synthetic-project" userId={userId} onAgentCanvasApplyChange={handleApplyChange} onAgentActionsChange={setCanvasActions} /><MediaAssistant userId={userId} attachmentsAllowed page="canvas" projectId="synthetic-project" selectedNode={null} onApplyCanvasPlan={applyCanvas ?? undefined} canvasActions={canvasActions} /></div></MemoryRouter>
  return <MemoryRouter><main style={{ padding: 24 }}><h1>AG-UI 助手验收</h1><p>所有模型、计费与写入均为合成数据。</p>{applied && <p role="status">已收到节点草案，未提交生成任务。</p>}{media
    ? <MediaAssistant userId={userId} attachmentsAllowed page={mode.startsWith('canvas-') ? 'canvas' : 'projects'} selectedNode={null} onApplyCanvasPlan={mode.startsWith('canvas-') ? () => setApplied(true) : undefined} canvasActions={{save:()=>Promise.resolve(),getDocument:emptyDocument,attachImageTask:()=>Promise.resolve()}} />
    : <BlogAssistant page={{ route: '/blog/studio/posts', section: 'posts', pageType: 'posts_list' }} editor={null} />}</main></MemoryRouter>
}
createRoot(document.getElementById('root')!).render(<Review />)
