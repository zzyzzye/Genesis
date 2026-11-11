/** 在 Compose 服务中验收真实画布组件，API 和草稿均使用独立合成数据。 */
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import './mediaCanvasNamesReview.css'
import { emptyDocument, type Document, type Node } from '../../src/pages/media/api'
import type { MediaCanvasActions } from '../../src/pages/media/MediaAssistant'
import { imageMentionToken } from '../../src/pages/media/canvasReferences'

if (!import.meta.env.DEV || !['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('仅用于本地浏览器验收')
// 与真实路由一致，先加载工作区基础样式，再加载画布专用覆盖样式。
const { ProjectCanvas } = await import('../../src/pages/media/ProjectCanvas')
const state = new URLSearchParams(location.search).get('state')
const taskReview = state?.startsWith('tasks-') ?? false
let reviewTask = { id:'review-task', node_id:'review-node-image_generation', status:state?.slice(6) ?? 'unknown', progress:0, error:'合成任务状态', asset_id:null as string | null }
const wheelAssets = [
  { id: 'wheel-image', name: '合成参考画面.svg', kind: 'image', mime_type: 'image/svg+xml', size: 1024, in_library: false },
  { id: 'wheel-audio', name: '合成静音.wav', kind: 'audio', mime_type: 'audio/wav', size: 8044, in_library: false },
]
const types: Node['type'][] = ['note', 'text', 'shape', 'image', 'audio', 'video_asset', 'video', 'image_generation', 'audio_generation', 'asset']
const nodes: Node[] = types.map((type, index) => ({
  id: `review-node-${type}`, type,
  asset_id: state === 'wheel' ? ['image', 'asset', 'image_generation'].includes(type) ? 'wheel-image' : ['audio', 'audio_generation'].includes(type) ? 'wheel-audio' : null : null,
  text: type === 'note' ? state === 'wheel' ? '用于检查编辑时的内部滚动。\n'.repeat(80) : '镜头从雨后的街道缓慢推进，保留环境声。' : type === 'text' ? '这是正文，改名不会改动它。' : type === 'shape' ? '第一幕' : '',
  x: 80 + index % 3 * (['drag', 'toolbar'].includes(state ?? '') ? 900 : 410), y: 150 + Math.floor(index / 3) * (['drag', 'toolbar'].includes(state ?? '') ? 600 : 330),
  width: ['drag', 'toolbar'].includes(state ?? '') && ['video', 'image_generation', 'audio_generation'].includes(type) ? 640 : 330,
  height: type === 'audio' ? 88 : ['drag', 'toolbar'].includes(state ?? '') && ['video', 'image_generation', 'audio_generation'].includes(type) ? 402 : 220,
}))
nodes.unshift({ id: 'review-node-group', type: 'group', asset_id: null, text: '开场分镜', member_ids: nodes.slice(0, 3).map((node) => node.id), x: 50, y: 106, width: state === 'drag' ? 2210 : 1210, height: 294 })
if (taskReview) {
  const source = nodes.find(node => node.type === 'image_generation')!
  Object.assign(source, {x:60,y:90,width:600,height:378,text:'合成生成验收',generation:{model:'合成模型',count:1}})
  nodes.splice(0,nodes.length,source,{id:'review-result',type:'image',asset_id:null,text:'',name:'合成结果',x:850,y:90,width:360,height:240,image_result:{task_id:reviewTask.id,index:0,status:reviewTask.status,error:reviewTask.error}})
}
if (state === 'references') {
  const image = nodes.find(node => node.type === 'image')!
  const video = nodes.find(node => node.type === 'video')!
  image.name = '生串上架'
  video.text = `承接${imageMentionToken(image.id)}的画面，保持人物与光线一致。`
}
let document: Document = { ...emptyDocument(), nodes: state === 'empty' ? [] : nodes, ...(state === 'references' ? { edges:[{ id:'review-image-reference', source:'review-node-image', target:'review-node-video' }] } : {}), ...(state === 'free-pan' ? { viewport: { x: 125, y: 70, zoom: .65 } } : {}) }
let version = 0
const snapshotKey = `genesis-node-name-review:snapshot:${state ?? 'normal'}`
const snapshot = sessionStorage.getItem(snapshotKey)
if (snapshot) ({ document, version } = JSON.parse(snapshot) as { document: Document; version: number })
const draftKey = 'genesis-media-draft:node-name-review:node-name-review'
localStorage.removeItem(draftKey)
const originalFetch = window.fetch.bind(window)
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin)
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init)
  if (!url.pathname.startsWith('/api/v1/media/')) return json({ detail: '验收页面不访问真实 API。' }, 503)
  const path = url.pathname.replace('/api/v1/media', '')
  if (taskReview && path.includes('/image-generations')) {
    if (init?.method === 'POST') {
      if (path.endsWith('/retry-download')) reviewTask = {...reviewTask,status:'completed',error:'',asset_id:'review-image'}
      else {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {request_id:string}
        reviewTask = {...reviewTask,id:body.request_id,status:'processing',error:'',asset_id:null}
      }
      return json(reviewTask)
    }
    return json(path.endsWith('/image-generations') ? [reviewTask] : reviewTask)
  }
  if (taskReview && path === '/image-models') return json({configured:true,references_ready:true,models:[{id:'合成模型',description:'合成模型介绍'}]})
  if (taskReview && path === '/assets/review-image') return json({id:'review-image',name:'找回的图片.svg',kind:'image',mime_type:'image/svg+xml',size:128,in_library:false})
  if (taskReview && path.startsWith('/assets/review-image/')) return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="360" height="240" fill="#54766b"/><text x="40" y="120" fill="white">已找回生成结果</text></svg>', {headers:{'Content-Type':'image/svg+xml'}})
  if (state === 'readonly' && init?.method && init.method !== 'GET') return json({ detail: '只读画布禁止写入。' }, 403)
  if (path.endsWith('/canvas') && init?.method === 'PUT') {
    document = (JSON.parse(typeof init.body === 'string' ? init.body : '{}') as { document: Document }).document
    version += 1
    sessionStorage.setItem(snapshotKey, JSON.stringify({ document, version }))
    if (state === 'drag') await new Promise((resolve) => setTimeout(resolve, 1000))
    return json({ version, document })
  }
  if (init?.method && init.method !== 'GET') return json({ detail: '验收页面只允许合成画布保存。' }, 503)
  if (path.endsWith('/canvas')) return state === 'notice' ? json({ detail: '画布暂时无法读取，请重试。' }, 503) : json({ version, document, read_only: state === 'readonly' })
  if (state === 'wheel' && path === '/assets/wheel-image/file') return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#303030"/><path d="M0 300 180 120 370 290 500 180 640 320V360H0Z" fill="#606060"/><text x="24" y="48" fill="#eee" font-family="sans-serif" font-size="26">双指平移验收 · 合成参考画面</text></svg>', { headers: { 'Content-Type': 'image/svg+xml' } })
  if (state === 'wheel' && path === '/assets/wheel-audio/file') {
    const bytes = new Uint8Array(8044)
    const header = new DataView(bytes.buffer)
    for (const [offset, label] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) for (let i = 0; i < label.length; i++) bytes[offset + i] = label.charCodeAt(i)
    header.setUint32(4, 8036, true); header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true)
    header.setUint32(24, 8000, true); header.setUint32(28, 8000, true); header.setUint16(32, 1, true); header.setUint16(34, 8, true); header.setUint32(40, 8000, true)
    bytes.fill(128, 44)
    return new Response(bytes, { headers: { 'Content-Type': 'audio/wav' } })
  }
  if (path.endsWith('/assets')) return json({ items: state === 'wheel' ? wheelAssets : [], total: state === 'wheel' ? wheelAssets.length : 0 })
  if (path.endsWith('-models')) return json(state === 'toolbar' ? { configured: true, references_ready: true, models: Array.from({ length: 24 }, (_, index) => ({ id: `合成${path.includes('image') ? '影像' : '视频'}模型-${index + 1}`, description: '隔离模型配置工具栏验收，不调用真实生成服务。', pricing: { status: index === 1 ? 'unavailable' : 'available', currency: 'CNY', unit: 'request', amount: '0.55', tiers: [], note: index === 1 ? '价格服务尚未配置，暂无法预览。' : '实际上游账单为准。' } })) } : { configured: false, references_ready: false, models: [] })
  if (path.includes('-generations')) return json([])
  if (path === '/projects/node-name-review') return json({ id: 'node-name-review', name: state === 'wheel' ? '双指平移验收' : '节点名称验收', version: 0 })
  return json({ detail: '验收页面不访问真实 API。' }, 503)
}
window.addEventListener('pagehide', () => localStorage.removeItem(draftKey))
let actions: MediaCanvasActions | null = null
if (state === 'drag') {
  const trace = window.document.createElement('output')
  trace.id = 'review-drag-trace'
  trace.hidden = new URLSearchParams(location.search).get('trace') !== '1'
  trace.style.cssText = 'position:fixed;top:70px;left:12px;z-index:30;max-width:450px;font:11px monospace;white-space:pre-wrap;pointer-events:none;color:#ddd;background:#222c'
  window.document.body.append(trace)
  let activeId = ''
  const samples: unknown[] = []
  for (const phase of ['mousedown', 'mousemove', 'mouseup'] as const) window.addEventListener(phase, (event) => {
    if (phase === 'mousedown') { activeId = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node')?.dataset.id ?? ''; samples.length = 0 }
    if (!activeId || phase === 'mousemove' && !event.buttons) return
    requestAnimationFrame(() => {
      const node = actions?.getDocument().nodes.find((node) => node.id === activeId)
      const element = window.document.querySelector<HTMLElement>(`.react-flow__node[data-id="${activeId}"]`)
      samples.push({ phase, id: activeId, pointer: [event.clientX, event.clientY], position: node ? [node.x, node.y] : null, transform: element?.style.transform })
      trace.textContent = JSON.stringify(samples.slice(-12), null, 1)
    })
  }, true)
}
createRoot(window.document.getElementById('root')!).render(<MemoryRouter><ProjectCanvas projectId="node-name-review" userId="node-name-review" onAgentActionsChange={(value) => { actions = value }} /></MemoryRouter>)
