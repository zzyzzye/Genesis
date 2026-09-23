import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Project } from './api'
import { AssetLibrary } from './AssetLibrary'

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
  return <main className="media-project-workspace media-assets-workspace">
    <header className="media-assets-page-heading">
      <div><Link className="media-back" to="/media">← 返回影音</Link><small>ACCOUNT MATERIALS</small><h1>账户素材库</h1><p>这里的素材可以在不同作品中重复使用。</p></div>
    </header>
    <AssetLibrary presentation="page" onClose={() => { void navigate('/media') }} />
  </main>
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

  return <main className="media-project-workspace media-assets-workspace">
    <header className="media-assets-page-heading">
      <div><Link className="media-back" to={`/media/projects/${projectId}`}>← 返回作品</Link><small>PROJECT MATERIALS</small><h1>作品素材库</h1><p><strong>{project?.name ?? (error ? '无法打开作品素材库' : '正在加载作品…')}</strong><br />上传的文件归当前作品所有。账户素材会以引用方式加入，不会重复上传。</p></div>
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
  </main>
}
