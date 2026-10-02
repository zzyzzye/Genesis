import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Project } from './api'
import { AssetLibrary } from './AssetLibrary'
import { ArrowLeft, FolderOpen, House, Layers3, Menu, X } from 'lucide-react'
import type { ReactNode } from 'react'
import './MediaHome.css'
import './MediaAssets.css'

function AssetsLayout({ children, projectId }: { children: ReactNode; projectId?: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open])
  return <div className="media-home media-assets-shell">
    <aside className={`media-home-sidebar${open ? ' is-open' : ''}`} aria-label="影音导航">
      <Link className="media-home-brand" to="/"><Layers3 />Genesis<span className="media-home-brand-label">STUDIO</span></Link>
      <nav aria-label="创作空间"><Link to="/media"><House />首页</Link><Link to="/media?view=projects"><FolderOpen />项目</Link><Link to="/media/assets" aria-current={!projectId ? 'page' : undefined}><Layers3 />账户素材库</Link>{projectId && <Link to={`/media/projects/${projectId}/assets`} aria-current="page"><FolderOpen />作品素材库</Link>}</nav>
      <div className="media-home-sidebar-bottom"><Link to="/media"><ArrowLeft />返回影音</Link></div>
    </aside>
    {open && <button className="media-home-nav-scrim" aria-label="收起导航" onClick={() => setOpen(false)} />}
    <main className="media-project-workspace media-assets-workspace"><button className="media-assets-nav-toggle" aria-label={open ? '收起导航' : '展开导航'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>{children}</main>
  </div>
}

export function ProjectOverviewPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null)
  const [assetCount, setAssetCount] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    void Promise.all([
      api<Project>(`/projects/${projectId}`),
      api<{ total: number }>(`/projects/${projectId}/assets?page_size=1`),
    ]).then(([result, assets]) => {
      if (active) {
        setProject(result)
        setAssetCount(assets.total)
        setError('')
      }
    }).catch((reason: Error) => {
      if (active) setError(reason.message)
    })
    return () => { active = false }
  }, [projectId, retry])

  if (error) return <main className="media-projects"><Link className="media-back" to="/media">← 我的作品</Link><p className="media-error" role="alert">{error} <button onClick={() => setRetry((value) => value + 1)}>重试</button></p></main>
  if (!project) return <main className="media-gate" role="status">正在打开作品…</main>

  return <main className="media-project-workspace">
    <Link className="media-back" to="/media">← 我的作品</Link>
    <header className="media-workspace-heading">
      <div><small>YOUR PROJECT</small><h1>{project.name}</h1><p>先整理这部作品的素材，再进入画布安排镜头和想法。</p></div>
      <Link className="media-accent" to={`/media/projects/${projectId}/canvas`}>进入画布 <span aria-hidden="true">↗</span></Link>
    </header>
    <section className="media-workspace-sections" aria-label="作品空间">
      <Link className="media-workspace-card is-active" to={`/media/projects/${projectId}/assets`}>
        <small>01 / MATERIALS</small><h2>作品素材库</h2><p>本作品专属素材与账户素材引用都在这里。</p><span>{assetCount === null ? '载入中…' : `${assetCount} 项素材`} · →</span>
      </Link>
      <Link className="media-workspace-card" to={`/media/projects/${projectId}/canvas`}>
        <small>02 / CANVAS</small><h2>无限画布</h2><p>把图片、视频、声音与文字便签排进创作空间。</p><span>打开画布 · →</span>
      </Link>
    </section>
  </main>
}

export function AccountAssetsPage() {
  const navigate = useNavigate()
  return <AssetsLayout>
    <header className="media-assets-page-heading">
      <div><h1>账户素材库</h1><p>可在不同作品中重复使用的素材</p></div>
    </header>
    <AssetLibrary presentation="page" onClose={() => { void navigate('/media') }} />
  </AssetsLayout>
}

export function ProjectAssetsPage({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void api<Project>(`/projects/${projectId}`).then((result) => {
      if (active) setProject(result)
    }).catch((reason: Error) => {
      if (active) setError(reason.message)
    })
    return () => { active = false }
  }, [projectId])

  return <AssetsLayout projectId={projectId}>
    <header className="media-assets-page-heading">
      <div><Link className="media-back" to={`/media/projects/${projectId}`}>← 返回作品</Link><h1>作品素材库</h1><p>{project?.name ?? (error ? '无法打开作品素材库' : '正在加载作品…')}</p></div>
      <Link className="media-accent" to={`/media/projects/${projectId}/canvas`}>进入画布 <span aria-hidden="true">↗</span></Link>
    </header>
    {error ? <p role="alert" className="media-error">{error}</p> : project ? <AssetLibrary
      projectId={projectId}
      presentation="page"
      onClose={() => { void navigate(`/media/projects/${projectId}`) }}
      onAdd={async (asset) => {
        await api(`/projects/${projectId}/assets/reference`, 'POST', { asset_id: asset.id })
        await navigate(`/media/projects/${projectId}/canvas?addAsset=${encodeURIComponent(asset.id)}`)
      }}
    /> : <p role="status">正在加载作品素材…</p>}
  </AssetsLayout>
}
