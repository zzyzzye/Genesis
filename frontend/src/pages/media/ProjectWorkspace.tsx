import { useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowUpRight, Clapperboard, Image, Images, PanelTop, Workflow } from 'lucide-react'
import { api, type Project } from './api'
import { AssetLibrary } from './AssetLibrary'
import { MediaPageHeading } from './MediaPageHeading'
import { ProjectCover, ProjectCoverDialog } from './ProjectPreview'
import './MediaAssets.css'

function ProjectNavigation({ projectId, assets = false }: { projectId: string; assets?: boolean }) {
  return <nav className="media-project-navigation" aria-label="作品导航">
    <Link to={`/media/projects/${projectId}`} aria-current={!assets ? 'page' : undefined}><PanelTop />作品概览</Link>
    <Link to={`/media/projects/${projectId}/assets`} aria-current={assets ? 'page' : undefined}><Images />作品素材</Link>
    <Link to={`/media/projects/${projectId}/canvas`}><Workflow />创作画布<ArrowUpRight /></Link>
  </nav>
}

export function ProjectOverviewPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<(Project & { read_only?: boolean }) | null>(null)
  const [assetCount, setAssetCount] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [coverOpen, setCoverOpen] = useState(false)

  useEffect(() => {
    let active = true
    void Promise.all([
      api<Project>(`/projects/${projectId}`),
      api<{ total: number }>(`/projects/${projectId}/assets?page_size=1`),
    ]).then(([result, assets]) => {
      if (active) { setProject(result); setAssetCount(assets.total); setError('') }
    }).catch((reason: Error) => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [projectId, retry])

  return <>
    <MediaPageHeading title={project?.name ?? '作品概览'} description={project ? <>更新于 <time dateTime={project.updated_at}>{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(project.updated_at))}</time></> : '查看作品与创作进展。'} />
    <ProjectNavigation projectId={projectId} />
    {error ? <div role="alert" className="media-home-list-state"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>重新加载</button></div> : !project ? <div className="media-home-list-state" role="status">正在打开作品…</div> : <section className="media-overview-content" aria-label="作品空间">
      <div className="media-overview-cover"><ProjectCover project={project} />{!project.read_only && <button className="media-home-set-cover" onClick={() => setCoverOpen(true)}><Image />设置封面</button>}</div>
      <div className="media-overview-destinations">
        <Link className="media-overview-destination" to={`/media/projects/${projectId}/canvas`}><Clapperboard /><div><h2>进入创作画布</h2><p>继续编排画面、声音与故事。</p><span>继续创作</span></div><ArrowUpRight /></Link>
        <Link className="media-overview-destination" to={`/media/projects/${projectId}/assets`}><Images /><div><h2>作品素材</h2><p>整理这个作品的图片、视频与音频。</p><span>{assetCount === null ? '正在读取素材…' : `${assetCount} 项素材`}</span></div><ArrowUpRight /></Link>
      </div>
    </section>}
    <AnimatePresence>{project && coverOpen && <ProjectCoverDialog key={project.id} project={project} onClose={() => setCoverOpen(false)} onSaved={updated => { setProject(updated); setCoverOpen(false) }} />}</AnimatePresence>
  </>
}

export function AccountAssetsPage() {
  const navigate = useNavigate()
  return <>
    <MediaPageHeading title="素材库" description="保存你的图片、视频与声音，在不同作品中复用。" />
    <div className="media-assets-page"><AssetLibrary presentation="page" onClose={() => { void navigate('/media') }} /></div>
  </>
}

export function ProjectAssetsPage({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void api<Project>(`/projects/${projectId}`).then(result => {
      if (active) setProject(result)
    }).catch((reason: Error) => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [projectId])

  const params = new URLSearchParams(location.search)
  const targetNode = params.get('targetNode')
  const requestedKind = params.get('targetKind')
  const targetKind: 'image' | 'audio' | 'video' | null = requestedKind === 'image' || requestedKind === 'audio' || requestedKind === 'video' ? requestedKind : null
  const targetQuery = targetNode && targetKind ? `&targetNode=${encodeURIComponent(targetNode)}&targetKind=${targetKind}` : ''
  return <>
    <MediaPageHeading title="作品素材" description={project?.name ?? '整理作品中的图片、视频与声音。'} />
    <ProjectNavigation projectId={projectId} assets />
    <div className="media-assets-page">{error ? <div role="alert" className="media-home-list-state">{error}</div> : project ? <AssetLibrary
      projectId={projectId}
      presentation="page"
      initialKind={targetKind === 'video' ? '' : targetKind ?? ''}
      targetKind={targetNode ? targetKind ?? undefined : undefined}
      onClose={() => { void navigate(targetNode ? `/media/projects/${projectId}/canvas` : `/media/projects/${projectId}`) }}
      onAdd={async asset => {
        await api(`/projects/${projectId}/assets/reference`, 'POST', { asset_id: asset.id })
        await navigate(`/media/projects/${projectId}/canvas?addAsset=${encodeURIComponent(asset.id)}${targetQuery}`)
      }}
    /> : <div role="status" className="media-home-list-state">正在加载作品素材…</div>}</div>
  </>
}
