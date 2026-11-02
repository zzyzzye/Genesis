import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Clapperboard, Images, Plus, RotateCcw } from 'lucide-react'
import { AssetPreview } from './AssetPreview'
import { api, type Asset, type Project } from './api'

type ProjectImages = { projectId: string; items: Asset[]; total: number; error: boolean }
const previewMaxBytes = 8 * 1024 * 1024

function useProjectImages(projectId: string | undefined, enabled = true) {
  const [result, setResult] = useState<ProjectImages | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!projectId || !enabled) return
    let active = true
    void api<{ items: Asset[]; total: number }>(`/projects/${projectId}/assets?kind=image&page_size=4`)
      .then((data) => {
        if (active) setResult({ projectId, items: data.items.filter((asset) => asset.kind === 'image' && asset.size <= previewMaxBytes), total: data.total, error: false })
      })
      .catch(() => { if (active) setResult({ projectId, items: [], total: 0, error: true }) })
    return () => { active = false }
  }, [projectId, enabled, attempt])

  const current = result?.projectId === projectId ? result : null
  return {
    items: current?.items ?? [],
    total: current?.total ?? 0,
    error: current?.error ?? false,
    loading: Boolean(projectId && !current),
    retry: () => { setResult(null); setAttempt((value) => value + 1) },
  }
}

export function ProjectCover({ projectId }: { projectId: string }) {
  const element = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const { items, loading } = useProjectImages(projectId, visible)

  useEffect(() => {
    if (visible || !element.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '240px' })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [visible])

  return <div ref={element} className="media-home-project-thumbnail" aria-hidden="true">
    {items[0] ? <AssetPreview asset={items[0]} thumbnail passive /> : <div className="media-home-cover-empty"><Clapperboard /><span>{loading ? '读取画面…' : '暂无画面预览'}</span></div>}
    <span className="media-home-project-open">打开项目<ArrowUpRight /></span>
  </div>
}

export function ProjectMonitor({ project, loading, unavailable, onCreate, onRetry }: { project?: Project; loading: boolean; unavailable: boolean; onCreate: () => void; onRetry?: () => void }) {
  const { items, total, error, loading: imagesLoading, retry } = useProjectImages(project?.id)
  const [selectedId, setSelectedId] = useState('')
  const selected = items.find((asset) => asset.id === selectedId) ?? items[0]

  return <section className="media-home-monitor" aria-labelledby="media-home-monitor-heading">
    <header className="media-home-monitor-heading">
      <div><span>{project ? '继续制作' : '开始制作'}</span><h2 id="media-home-monitor-heading" title={project?.name}>{project?.name ?? '你的下一部作品'}</h2></div>
      {project && <Link className="media-home-open-canvas" to={`/media/projects/${project.id}/canvas`}>进入画布<ArrowUpRight /></Link>}
    </header>
    <div className="media-home-monitor-screen">
      {selected ? <AssetPreview key={selected.id} asset={selected} /> : <div className="media-home-monitor-empty">
        <Clapperboard aria-hidden="true" />
        {loading || imagesLoading ? <p role="status">正在读取项目画面…</p> : unavailable ? <><p>项目暂时无法读取</p>{onRetry && <button onClick={onRetry}><RotateCcw />重新加载项目</button>}</> : error ? <><p>项目画面暂时无法读取</p><button onClick={retry}><RotateCcw />重新读取画面</button></> : project ? <><p>这个项目还没有可预览的图片</p><Link to={`/media/projects/${project.id}/assets`}>打开素材库<ArrowUpRight /></Link></> : <><p>从第一张画面开始</p><span>在画布中编排镜头、声音与故事。</span><button onClick={onCreate}><Plus />新建画布</button></>}
      </div>}
      {selected && <span className="media-home-monitor-caption"><Images />{selected.name}</span>}
    </div>
    <footer className="media-home-monitor-footer">
      <div className="media-home-frame-strip" aria-label="项目画面">
        {items.map((asset) => <button key={asset.id} aria-label={`预览画面：${asset.name}`} aria-pressed={selected?.id === asset.id} title={asset.name} onClick={() => setSelectedId(asset.id)}>
          <AssetPreview asset={asset} thumbnail passive />{selected?.id === asset.id && <Check className="media-home-frame-check" aria-hidden="true" />}
        </button>)}
        {!items.length && <span>{project ? '项目画面' : '创作监看区'}</span>}
      </div>
      {project && <Link to={`/media/projects/${project.id}/assets`}>{imagesLoading ? '读取素材…' : error ? '查看素材' : `${total} 张图片`}<ArrowUpRight /></Link>}
    </footer>
  </section>
}
