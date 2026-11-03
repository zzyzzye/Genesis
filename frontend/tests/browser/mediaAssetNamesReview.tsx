/** 合成素材与画布，验收改名、素材选择及刷新，不接触真实项目。 */
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import './mediaCanvasNamesReview.css'
import { emptyDocument, type Asset, type Document } from '../../src/pages/media/api'

if (!import.meta.env.DEV || !['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('仅用于本地浏览器验收')
const key = 'genesis-asset-name-review'
const asset: Asset = { id:'asset-review', name:'烧烤镜头 · 图片 1', kind:'image', mime_type:'image/svg+xml', size:1024, in_library:false }
let document: Document = { ...emptyDocument(), nodes:[
  { id:'source', type:'image_generation', name:'烧烤镜头', text:'夜市烧烤，镜头缓慢推进。', asset_id:null, x:70, y:120, width:600, height:378 },
  { id:'result', type:'image', name:asset.name, text:'', asset_id:asset.id, x:830, y:120, width:360, height:260 },
], edges:[{ id:'edge', source:'source', target:'result' }] }
let version = 0
const stored = sessionStorage.getItem(key)
if (stored) { const state = JSON.parse(stored) as { document:Document; name:string; version:number }; document = state.document; asset.name = state.name; version = state.version }
asset.download_name = `${asset.name}.svg`
localStorage.removeItem('genesis-media-draft:asset-name-review:asset-name-review')
const originalFetch = window.fetch.bind(window)
const json = (value: unknown) => new Response(JSON.stringify(value), { headers:{ 'Content-Type':'application/json' } })
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin)
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init)
  const path = url.pathname
  if (path.endsWith('/canvas')) {
    if (init?.method === 'PUT') {
      document = (JSON.parse(typeof init.body === 'string' ? init.body : '{}') as { document:Document }).document
      asset.name = document.nodes.find(node => node.asset_id === asset.id)?.name || asset.name
      asset.download_name = `${asset.name}.svg`
      version += 1
      sessionStorage.setItem(key, JSON.stringify({ document, name:asset.name, version }))
    }
    return json({ version, document })
  }
  if (path.endsWith('/assets/asset-review/file')) return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#593e27"/><text x="40" y="210" fill="#fff" font-size="30">合成成品 · 名称一致性验收</text></svg>', { headers:{ 'Content-Type':'image/svg+xml' } })
  if (path.endsWith('/assets/asset-review')) return json(asset)
  if (path.endsWith('/assets')) {
    const missing = url.searchParams.get('q')?.includes('不存在')
    return json({ items:missing ? [] : [asset], total:missing ? 0 : 1 })
  }
  if (path.endsWith('-models')) return json({ configured:false, models:[] })
  if (path.includes('-generations')) return json([])
  if (path.endsWith('/projects/asset-name-review')) return json({ id:'asset-name-review', name:'成品名称验收' })
  return json({ detail:'验收页面不访问真实 API。' })
}
const { ProjectCanvas } = await import('../../src/pages/media/ProjectCanvas')
createRoot(window.document.getElementById('root')!).render(<MemoryRouter><ProjectCanvas projectId="asset-name-review" userId="asset-name-review" /></MemoryRouter>)
