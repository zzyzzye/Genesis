/** 在 Compose 服务中验收真实画布组件，API 和草稿均使用独立合成数据。 */
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import './mediaCanvasNamesReview.css'
import { emptyDocument, type Document, type Node } from '../../src/pages/media/api'
import type { MediaCanvasActions } from '../../src/pages/media/MediaAssistant'

if (!import.meta.env.DEV || !['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('仅用于本地浏览器验收')
// 与真实路由一致，先加载工作区基础样式，再加载画布专用覆盖样式。
const { ProjectCanvas } = await import('../../src/pages/media/ProjectCanvas')
const state = new URLSearchParams(location.search).get('state')
const types: Node['type'][] = ['note', 'text', 'shape', 'image', 'audio', 'video_asset', 'video', 'image_generation', 'audio_generation', 'asset']
const nodes: Node[] = types.map((type, index) => ({
  id: `review-node-${type}`, type, asset_id: null, text: type === 'note' ? '镜头从雨后的街道缓慢推进，保留环境声。' : type === 'text' ? '这是正文，改名不会改动它。' : type === 'shape' ? '第一幕' : '',
  x: 80 + index % 3 * (state === 'drag' ? 900 : 410), y: 150 + Math.floor(index / 3) * (state === 'drag' ? 600 : 330),
  width: state === 'drag' && ['video', 'image_generation', 'audio_generation'].includes(type) ? 640 : 330,
  height: type === 'audio' ? 88 : state === 'drag' && ['video', 'image_generation', 'audio_generation'].includes(type) ? 402 : 220,
}))
nodes.unshift({ id: 'review-node-group', type: 'group', asset_id: null, text: '开场分镜', member_ids: nodes.slice(0, 3).map((node) => node.id), x: 50, y: 106, width: state === 'drag' ? 2210 : 1210, height: 294 })
let document: Document = { ...emptyDocument(), nodes: state === 'empty' ? [] : nodes }
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
  if (path.endsWith('/canvas') && init?.method === 'PUT') {
    document = (JSON.parse(typeof init.body === 'string' ? init.body : '{}') as { document: Document }).document
    version += 1
    sessionStorage.setItem(snapshotKey, JSON.stringify({ document, version }))
    if (state === 'drag') await new Promise((resolve) => setTimeout(resolve, 1000))
    return json({ version, document })
  }
  if (init?.method && init.method !== 'GET') return json({ detail: '验收页面只允许合成画布保存。' }, 503)
  if (path.endsWith('/canvas')) return json({ version, document })
  if (path.endsWith('/assets')) return json({ items: [], total: 0 })
  if (path.endsWith('-models')) return json({ configured: false, references_ready: false, models: [] })
  if (path.includes('-generations')) return json([])
  if (path === '/projects/node-name-review') return json({ id: 'node-name-review', name: '节点名称验收', version: 0 })
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
