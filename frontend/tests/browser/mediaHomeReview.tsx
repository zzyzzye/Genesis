/** 复用 Compose 前端与真实工作台组件，所有 API 读写均使用合成响应。 */
import { createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { MediaHome } from '../../src/pages/media/MediaHome'
import '../../styles/base.css'
import '../../styles/shared.css'
import '../../src/pages/media/MediaPage.css'

if (!import.meta.env.DEV || !['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('仅用于本地浏览器验收')
const state = new URLSearchParams(location.search).get('state')
const latestProject = { id: 'review-one', name: '雨后的城市 · 一段很长的项目名称用于检查窄屏与监看标题', version: 1, updated_at: '2026-11-02T00:00:00Z' }
const projects = [
  latestProject,
  { id: 'review-two', name: '还没有图片的声音项目', version: 0, updated_at: '2026-11-01T00:00:00Z' },
  { id: 'review-three', name: '下一个故事', version: 0, updated_at: '2026-10-31T00:00:00Z' },
]
const images = [
  { id: 'review-frame-one', name: '夜幕.png', kind: 'image', mime_type: 'image/svg+xml', size: state === 'large' ? 9 * 1024 * 1024 : 1024, in_library: false },
  { id: 'review-frame-two', name: '晨光.png', kind: 'image', mime_type: 'image/svg+xml', size: state === 'large' ? 10 * 1024 * 1024 : 1024, in_library: false },
]
const originalFetch = window.fetch.bind(window)
let listFailures = 0
let previewFailures = 0
let imageFailures = 0
let writeFailures = 0
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin)
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init)
  if (!url.pathname.startsWith('/api/v1/media/')) return json({ detail: '验收页面不访问真实 API。' }, 503)
  const path = url.pathname.replace('/api/v1/media', '')
  if (init?.method && init.method !== 'GET') {
    if (state === 'save-error' && writeFailures++ === 0) return json({ detail: '保存失败，请重试。' }, 503)
    if (init.method === 'DELETE') return new Response(null, { status: 204 })
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as { name?: string }
    return json({ ...latestProject, name: body.name ?? latestProject.name }, 201)
  }
  if (path === '/projects') {
    if (state === 'loading') await new Promise((resolve) => setTimeout(resolve, 5000))
    if (state === 'error' && listFailures++ === 0) return json({ detail: '项目暂时无法读取，请重试。' }, 503)
    return json(state === 'empty' ? [] : projects)
  }
  if (path.includes('/projects/') && path.endsWith('/assets')) {
    if (!path.includes('review-one')) return json({ items: [], total: 0 })
    if (state === 'preview-error' && previewFailures++ < 2) return json({ detail: '预览暂不可用。' }, 503)
    return json({ items: images, total: images.length })
  }
  if (path.startsWith('/assets/') && path.endsWith('/file')) {
    if (state === 'image-error' && path.includes('frame-one') && imageFailures++ < 1) return json({ detail: '图片暂不可用。' }, 503)
    const night = path.includes('frame-one')
    const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="${night ? '#263f4c' : '#b58055'}"/><circle cx="940" cy="180" r="90" fill="${night ? '#d3dce1' : '#f0d2a1'}"/><path d="M0 500 340 280 640 490 900 360 1280 560V720H0Z" fill="#10181b"/><text x="48" y="72" fill="#fff" font-family="sans-serif" font-size="28">合成验收画面 · ${night ? '夜幕' : '晨光'}</text></svg>`
    return new Response(artwork, { headers: { 'Content-Type': 'image/svg+xml' } })
  }
  return json({ detail: '验收页面不访问真实 API。' }, 503)
}

export function Destination() {
  return <main style={{ padding: 32 }}><h1>画布入口已打开</h1><p>这里只检查导航，不创建真实项目。</p><Link to="/media">返回工作台</Link></main>
}

createRoot(document.getElementById('root')!).render(<div className="media-workspace"><MemoryRouter initialEntries={['/media']}><Routes>
  <Route path="/media" element={<MediaHome />} />
  <Route path="/media/projects/:id/canvas" element={<Destination />} />
  <Route path="/media/projects/:id" element={<Destination />} />
  <Route path="/media/projects/:id/assets" element={<Destination />} />
</Routes></MemoryRouter></div>)
