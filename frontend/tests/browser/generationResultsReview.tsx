/** 仅在专用本地域名使用合成身份、任务和素材，不读取真实登录状态或调用上游。 */
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import './mediaCanvasNamesReview.css'
import { defaultGenerationSettings, emptyDocument, type Document, type Asset } from '../../src/pages/media/api'
import type { GenerationTask } from '../../src/pages/media/VideoGeneration'
import { storeAuthToken } from '../../src/lib/auth'

if (!import.meta.env.DEV || location.hostname !== 'genesis-result-review-01a19f32.localhost') throw new Error('仅用于独立本地域名验收')
storeAuthToken('synthetic-generation-review')
const kind = new URLSearchParams(location.search).get('kind') === 'image' ? 'image' : 'video'
let snapshot: Document = { ...emptyDocument(), nodes:[{ id:'review-source', type:kind === 'video' ? 'video' : 'image_generation', asset_id:null, name:kind === 'video' ? '夜市生视频' : '夜市生图', text:'夜市灯光下的烧烤摊，镜头缓慢推进。', x:80, y:100, width:600, height:378, generation:{...defaultGenerationSettings(), model:'synthetic-model', image_ratio:'16:9'} }] }
let version = 0
let task: GenerationTask | null = null
const savedKey = `generation-results-review:${kind}`
const saved = localStorage.getItem(savedKey)
if (saved) ({snapshot, version, task} = JSON.parse(saved) as {snapshot:Document;version:number;task:GenerationTask|null})
const persist = () => {
  localStorage.setItem(savedKey, JSON.stringify({snapshot,version,task}))
  const status = window.document.getElementById('synthetic-snapshot')
  if (status) status.textContent = `模拟服务器已存 ${snapshot.nodes.length} 个节点`
}
const image = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#194435"/><text x="50" y="190" fill="#a1e8cb" font-size="32">合成图片结果</text></svg>'], { type:'image/svg+xml' })
const surface = window.document.createElement('canvas')
surface.width = 320; surface.height = 180
const painter = surface.getContext('2d')!
const stream = surface.captureStream(5)
const video = await new Promise<Blob>(resolve => {
  const parts: BlobPart[] = []
  const recorder = new MediaRecorder(stream, { mimeType:'video/webm' })
  recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data) }
  recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()); resolve(new Blob(parts, {type:'video/webm'})) }
  recorder.start()
  painter.fillStyle = '#194435'; painter.fillRect(0,0,320,180)
  painter.fillStyle = '#a1e8cb'; painter.font = '22px sans-serif'; painter.fillText('合成视频结果',60,95)
  setTimeout(() => recorder.stop(), 1000)
})
const file = kind === 'video' ? video : image
const asset: Asset = { id:'review-asset', name:`夜市 · ${kind === 'video' ? '视频' : '图片'} 1`, kind, mime_type:file.type, size:file.size, in_library:false }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status,headers:{'Content-Type':'application/json'}})
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin)
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init)
  const path = url.pathname.replace('/api/v1/media','')
  if (path.endsWith('/canvas')) {
    if (init?.method === 'PUT') { snapshot = (JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {document:Document}).document; version++; persist() }
    return json({version,document:snapshot})
  }
  if (path.endsWith('-models')) return json({configured:true,references_ready:true,models:[{id:'synthetic-model'}]})
  if (path === `/projects/result-review/${kind}-generations` && init?.method === 'POST') {
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {request_id:string;node_id:string}
    task = {id:body.request_id,node_id:body.node_id,status:'processing',progress:30,error:'',asset_id:null}
    persist()
    return json(task,202)
  }
  if (path.includes('-generations/')) return task ? json(task) : json({detail:'任务不存在'},404)
  if (path.endsWith('-generations')) return json(task ? [task] : [])
  if (path === '/assets/review-asset/file') return new Response(file, {headers:{'Content-Type':file.type}})
  if (path === '/assets/review-asset') return json(asset)
  if (path.endsWith('/assets')) return json({items:task?.status === 'completed' ? [asset] : [],total:task?.status === 'completed' ? 1 : 0})
  if (path === '/projects/result-review') return json({id:'result-review',name:'自动成品验收'})
  return json({detail:'隔离验收不访问真实 API'},503)
}
const { ProjectCanvas } = await import('../../src/pages/media/ProjectCanvas')
export function GenerationResultsReview() {
  return <MemoryRouter><ProjectCanvas projectId="result-review" userId="synthetic-review" /><div style={{position:'fixed',top:12,right:16,zIndex:80,display:'flex',gap:8}}>
    <output id="synthetic-snapshot">模拟服务器恢复 {snapshot.nodes.length} 个节点</output>
    <button onClick={() => { if (task) { task = {...task,status:'completed',progress:100,asset_id:asset.id,asset_ids:[asset.id]}; persist() } }}>完成合成任务</button>
    <button onClick={() => { if (task) { task = {...task,status:'failed',error:'合成失败原因'}; persist() } }}>模拟失败</button>
  </div></MemoryRouter>
}
createRoot(window.document.getElementById('root')!).render(<GenerationResultsReview />)
