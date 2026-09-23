import { useEffect, useRef, useState } from 'react'
import { api, type Asset, upload } from './api'
import { AssetPreview } from './AssetPreview'

export function AssetLibrary({ projectId, onClose, onAdd, onRemoved, beforeRemove, presentation = 'drawer' }: { projectId?: string; onClose: () => void; onAdd?: (asset: Asset) => Promise<void>; onRemoved?: () => Promise<void>; beforeRemove?: () => Promise<void>; presentation?: 'drawer' | 'page' }) {
  const [scope, setScope] = useState(projectId ? 'project' : 'account')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [items, setItems] = useState<Asset[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [retryFile, setRetryFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const path = scope === 'project' ? `/projects/${projectId}/assets` : '/assets'
  useEffect(() => { if (presentation === 'drawer') close.current?.focus() }, [presentation])
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      void api<{ items: Asset[]; total: number }>(`${path}?${new URLSearchParams({ q: query, page: String(page), ...(kind ? { kind } : {}) })}`).then((result) => {
        if (active) { setItems(result.items); setTotal(result.total); setError('') }
      }).catch((reason: Error) => { if (active) setError(reason.message) }).finally(() => { if (active) setLoading(false) })
    }, 180)
    return () => { active = false; window.clearTimeout(timer) }
  }, [path, query, kind, page, refresh])
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action(); setRefresh((value) => value + 1) } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  async function importFile(file: File) {
    setRetryFile(file)
    if (file.size > 200 * 1024 * 1024) { setError('单个文件不能超过 200 MiB'); return }
    await run(async () => {
      setProgress(0)
      try { await upload(path, file, setProgress); setRetryFile(null) } finally { setProgress(null) }
    })
  }
  return <section className={presentation === 'page' ? 'media-asset-library-page' : 'media-drawer'} {...(presentation === 'drawer' ? { role: 'dialog', 'aria-label': '素材库' } : {})} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <div className="media-drawer-heading"><div><small>YOUR MATERIALS</small><h2>素材库</h2></div><button ref={close} onClick={onClose} aria-label={presentation === 'page' ? '返回作品' : '关闭素材库'}>{presentation === 'page' ? '← 返回作品' : '✕'}</button></div>
    <div className="media-scope">{projectId && <button aria-pressed={scope === 'project'} onClick={() => { setScope('project'); setPage(1) }}>作品素材</button>}<button aria-pressed={scope === 'account'} onClick={() => { setScope('account'); setPage(1) }}>账户素材</button></div>
    <p className="media-muted">{scope === 'project' ? '这里上传的文件仅用于当前作品，可随时加入账户库。' : '账户私有素材，可供多个作品重复使用。'}</p>
    <div className="media-library-search"><input aria-label="搜索素材" placeholder="搜索素材名称" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} /><select aria-label="素材类型" value={kind} onChange={(event) => { setKind(event.target.value); setPage(1) }}><option value="">全部类型</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select></div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/*,audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = '' }} />
    <button className="media-accent" disabled={busy} onClick={() => input.current?.click()}>＋ 导入{scope === 'account' ? '账户' : '作品'}素材</button>
    {progress !== null && <div role="status"><progress max={100} value={progress} /> {progress === 100 ? '正在保存文件…' : `${progress}%`}</div>}
    {error && <div role="alert" className="media-error">{error} {retryFile && <button disabled={busy} onClick={() => void importFile(retryFile)}>重试上传</button>}<button disabled={busy} onClick={() => setRefresh(refresh + 1)}>重新加载</button></div>}
    {loading ? <p role="status">加载素材…</p> : items.length === 0 ? <div className="media-library-empty">{query || kind ? '没有匹配的素材' : '素材库还是空的'}<p>导入图片、视频或音频开始创作。</p></div> : <div className="media-library-grid">{items.map((asset) => <article key={asset.id}>
      <AssetPreview asset={asset} controls />
      <strong title={asset.name}>{asset.name}</strong><small>{(asset.size / 1024 / 1024).toFixed(1)} MiB · {asset.kind}</small>
      <div className="media-asset-actions">{onAdd && <button disabled={busy} onClick={() => void run(() => onAdd(asset))}>放入画布</button>}{!asset.in_library && <button disabled={busy} onClick={() => void run(() => api(`/assets/${asset.id}/library`, 'POST'))}>加入账户库</button>}
        <button disabled={busy} onClick={() => { if (window.confirm(scope === 'project' ? '移除该作品素材及其画布节点？账户素材会保留。' : '删除此账户素材？正在被作品引用的素材无法删除。')) void run(async () => { if (scope === 'project') await beforeRemove?.(); await api(`${path}/${asset.id}`, 'DELETE'); if (scope === 'project') await onRemoved?.() }) }}>{scope === 'project' ? '移出作品' : '删除'}</button></div>
    </article>)}</div>}
    <div className="media-pagination"><button disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>上一页</button><span>{page} / {Math.max(1, Math.ceil(total / 24))}</span><button disabled={page * 24 >= total || busy} onClick={() => setPage(page + 1)}>下一页</button></div>
  </section>
}
