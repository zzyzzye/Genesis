/** 在既有 Compose 服务中使用合成画布和目录，不访问真实业务数据。 */
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import './mediaCanvasNamesReview.css'
import { defaultGenerationSettings, emptyDocument, type Document } from '../../src/pages/media/api'

if (!import.meta.env.DEV || !['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('仅用于本地浏览器验收')
const state = new URLSearchParams(location.search).get('state')
const kind = new URLSearchParams(location.search).get('kind') === 'video' ? 'video' : 'image'
let document: Document = { ...emptyDocument(), nodes:[{
  id:'refresh-node', type:kind === 'image' ? 'image_generation' : 'video', name:'模型刷新验收', asset_id:null, text:'雨后街道，镜头缓慢推进。',
  x:80, y:120, width:600, height:378, generation:{ ...defaultGenerationSettings(), model:'current-model' },
}] }
let version = 0
let refreshCount = 0
const originalFetch = window.fetch.bind(window)
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers:{ 'Content-Type':'application/json' } })
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin)
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init)
  if (!url.pathname.startsWith('/api/v1/media/')) return json({ detail:'验收页面不访问真实 API。' }, 503)
  const path = url.pathname.replace('/api/v1/media', '')
  if (path.endsWith('/canvas')) {
    if (init?.method === 'PUT') { document = (JSON.parse(typeof init.body === 'string' ? init.body : '{}') as { document: Document }).document; version += 1 }
    return json({ version, document })
  }
  if (init?.method && init.method !== 'GET') return json({ detail:'验收页面不允许生成任务。' }, 503)
  if (path.endsWith('-models')) {
    const refresh = url.searchParams.get('refresh') === 'true'
    if (refresh) {
      refreshCount += 1
      await new Promise(resolve => setTimeout(resolve, 1400))
      if (state === 'error' && refreshCount === 1) return json({ detail:'模型目录暂不可用，请重试。' }, 502)
    }
    const ids = state === 'empty' && !refresh ? [] : refresh ? ['new-model', 'current-model', ...Array.from({ length:22 }, (_, i) => `synthetic-model-${i + 1}`)] : ['current-model']
    return json({ configured:true, references_ready:true, models:ids.map(id => ({ id, description:'合成模型简介，用于验证画布菜单刷新与价格浮层。', pricing:{ status:'available', currency:'CNY', unit:'request', amount:'0.55', tiers:[], note:'合成价格，不产生费用。' } })) })
  }
  if (path.includes('-generations')) return json([])
  if (path.endsWith('/assets')) return json({ items:[], total:0 })
  if (path === '/projects/model-refresh-review') return json({ id:'model-refresh-review', name:'画布模型刷新验收' })
  return json({ detail:'验收页面不访问真实 API。' }, 503)
}
const { ProjectCanvas } = await import('../../src/pages/media/ProjectCanvas')
createRoot(window.document.getElementById('root')!).render(<MemoryRouter><ProjectCanvas projectId="model-refresh-review" userId="model-refresh-review" /></MemoryRouter>)
