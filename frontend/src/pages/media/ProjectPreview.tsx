import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Clapperboard, X } from 'lucide-react'
import { AssetPreview } from './AssetPreview'
import { AssetLibrary } from './AssetLibrary'
import { api, type Asset, type Project } from './api'
import { MediaDialog } from './MediaMotion'

export function ProjectCover({ project }: { project: Project }) {
  const element = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [result, setResult] = useState<{ key: string; asset?: Asset; error?: boolean } | null>(null)
  const key = `${project.id}:${project.cover_asset_id ?? 'auto'}`

  useEffect(() => {
    if (visible || !element.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '240px' })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    let active = true
    const load = project.cover_asset_id
      ? api<Asset>(`/assets/${project.cover_asset_id}`)
      : api<{ items: Asset[] }>(`/projects/${project.id}/assets?kind=image&page_size=1`).then(data => data.items[0])
    void load.then(asset => {
      if (active) setResult({ key, asset: asset?.kind === 'image' ? asset : undefined })
    }).catch(() => { if (active) setResult({ key, error: true }) })
    return () => { active = false }
  }, [visible, key, project.id, project.cover_asset_id])

  const current = result?.key === key ? result : null
  return <div ref={element} className="media-home-project-thumbnail" aria-hidden="true">
    {current?.asset ? <AssetPreview asset={current.asset} thumbnail={current.asset.size > 8 * 1024 * 1024} passive /> : <div className="media-home-cover-empty"><Clapperboard /><strong>{project.name}</strong><span>{!current ? '读取封面…' : current.error ? '封面暂不可用' : '尚未设置封面'}</span></div>}
    <span className="media-home-project-open">打开作品<ArrowUpRight /></span>
  </div>
}

export function ProjectCoverDialog({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: (project: Project) => void }) {
  const close = useRef<HTMLButtonElement>(null)
  const saving = useRef(false)
  const closeDialog = () => { if (!saving.current && !close.current?.closest('dialog')?.querySelector('[aria-busy=true]')) onClose() }

  async function selectCover(asset: Asset) {
    saving.current = true
    try {
      const updated = await api<Project>(`/projects/${project.id}/cover`, 'PUT', { asset_id: asset.id })
      onSaved(updated)
    } finally { saving.current = false }
  }

  return <MediaDialog initialFocus={close} className="media-home-dialog media-home-cover-dialog" aria-labelledby="media-home-cover-title" onCancel={(event) => { event.preventDefault(); closeDialog() }}>
    <header><div><h2 id="media-home-cover-title">设置作品封面</h2><p>{project.name}</p></div><button ref={close} aria-label="关闭封面选择" onClick={closeDialog}><X /></button></header>
    <p className="media-home-cover-hint">上传本地图片直接设为封面，也可以选择已有素材。封面按 16:9 展示。</p>
    <AssetLibrary projectId={project.id} presentation="page" selectionOnly targetKind="image" fixedKind="image" selectionLabel="设为封面" selectedAssetId={project.cover_asset_id} uploadLabel="上传自定义封面" onUploaded={selectCover} onClose={closeDialog} onAdd={selectCover} />
  </MediaDialog>
}
