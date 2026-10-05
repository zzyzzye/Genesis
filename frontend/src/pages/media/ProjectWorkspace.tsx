import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, type Project } from './api'
import { AssetLibrary } from './AssetLibrary'
import { ArrowLeft, ArrowUpRight, Clapperboard, FolderOpen, House, Layers3, Menu, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { PanelsTopLeft, LibraryBig, Images, LayoutDashboard, Workflow } from 'lucide-react'
import './MediaHome.css'
import './MediaAssets.css'

function AssetsLayout({ children, projectId, overview = false }: { children: ReactNode; projectId?: string; overview?: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open])
  return <div className={`media-home media-assets-shell${overview ? ' media-overview-shell' : ''}`}>
    <aside className={`media-home-sidebar${open ? ' is-open' : ''}`} aria-label="影音导航" onClick={(event) => { if ((event.target as Element).closest('a')) setOpen(false) }}>
      <Link className="media-home-brand" to="/"><Layers3 />Genesis<span className="media-home-brand-label">STUDIO</span></Link>
      <nav aria-label="创作空间"><Link to="/media"><House />首页</Link><Link to="/media?view=projects"><PanelsTopLeft />项目</Link><Link to="/media/assets" aria-current={!projectId ? 'page' : undefined}><LibraryBig />账户素材库</Link>{projectId && <><span className="media-home-nav-label">当前作品</span><Link to={`/media/projects/${projectId}`} aria-current={overview ? 'page' : undefined}><LayoutDashboard />作品概览</Link><Link to={`/media/projects/${projectId}/assets`} aria-current={!overview ? 'page' : undefined}><Images />作品素材库</Link><Link to={`/media/projects/${projectId}/canvas`}><Workflow />创作画布</Link></>}</nav>
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

  if (error) return <AssetsLayout projectId={projectId} overview><p className="media-error" role="alert">{error} <button onClick={() => setRetry((value) => value + 1)}>重试</button></p></AssetsLayout>
  if (!project) return <AssetsLayout projectId={projectId} overview><p role="status">正在打开作品…</p></AssetsLayout>

  return <AssetsLayout projectId={projectId} overview>
    <Link className="media-back" to="/media?view=projects">← 全部项目</Link>
    <header className="media-overview-heading">
      <div><span>作品概览</span><h1>{project.name}</h1><p>更新于 <time dateTime={project.updated_at}>{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(project.updated_at))}</time></p></div>
      <Link className="media-accent" to={`/media/projects/${projectId}/canvas`}>进入画布<ArrowUpRight /></Link>
    </header>
    <section className="media-overview-destinations" aria-label="作品空间">
      <Link className="media-overview-destination" to={`/media/projects/${projectId}/assets`}>
        <FolderOpen /><div><h2>作品素材库</h2><p>管理这个作品的图片、视频和音频</p><span>{assetCount === null ? '载入中…' : `${assetCount} 项素材`}</span></div><ArrowUpRight />
      </Link>
      <Link className="media-overview-destination" to={`/media/projects/${projectId}/canvas`}>
        <Clapperboard /><div><h2>创作画布</h2><p>编排镜头、连接素材与记录想法</p><span>继续创作</span></div><ArrowUpRight />
      </Link>
    </section>
  </AssetsLayout>
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
  const location = useLocation()
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

  const params = new URLSearchParams(location.search)
  const targetNode = params.get('targetNode')
  const requestedKind = params.get('targetKind')
  const targetKind: 'image' | 'audio' | 'video' | null = requestedKind === 'image' || requestedKind === 'audio' || requestedKind === 'video' ? requestedKind : null
  const targetQuery = targetNode && targetKind ? `&targetNode=${encodeURIComponent(targetNode)}&targetKind=${targetKind}` : ''
  return <AssetsLayout projectId={projectId}>
    <header className="media-assets-page-heading">
      <div><Link className="media-back" to={`/media/projects/${projectId}`}>← 返回作品</Link><h1>作品素材库</h1><p>{project?.name ?? (error ? '无法打开作品素材库' : '正在加载作品…')}</p></div>
      <Link className="media-accent" to={`/media/projects/${projectId}/canvas`}>进入画布 <span aria-hidden="true">↗</span></Link>
    </header>
    {error ? <p role="alert" className="media-error">{error}</p> : project ? <AssetLibrary
      projectId={projectId}
      presentation="page"
      initialKind={targetKind === 'video' ? '' : targetKind ?? ''}
      targetKind={targetNode ? targetKind ?? undefined : undefined}
      onClose={() => { void navigate(targetNode ? `/media/projects/${projectId}/canvas` : `/media/projects/${projectId}`) }}
      onAdd={async (asset) => {
        await api(`/projects/${projectId}/assets/reference`, 'POST', { asset_id: asset.id })
        await navigate(`/media/projects/${projectId}/canvas?addAsset=${encodeURIComponent(asset.id)}${targetQuery}`)
      }}
    /> : <p role="status">正在加载作品素材…</p>}
  </AssetsLayout>
}
