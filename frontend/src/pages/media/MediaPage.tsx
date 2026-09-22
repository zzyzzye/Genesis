import './MediaPage.css'

import { AudioLines, ChevronLeft, Film, Grid2X2, Image, Library, Maximize2, MousePointer2, Plus, Search, Upload, ZoomIn, ZoomOut } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

type AssetKind = 'video' | 'image' | 'audio'
type MediaAsset = { id: string; name: string; kind: AssetKind; meta: string; color: string }
type CanvasNode = { id: string; assetId: string; x: number; y: number }

const assets: MediaAsset[] = [
  { id: 'asset-1', name: '城市夜行 01', kind: 'video', meta: '00:18 · 4K', color: 'violet' },
  { id: 'asset-2', name: '玻璃折射', kind: 'image', meta: '3840 × 2160', color: 'cyan' },
  { id: 'asset-3', name: '片头氛围', kind: 'audio', meta: '00:42 · WAV', color: 'lime' },
  { id: 'asset-4', name: '工作室空镜', kind: 'video', meta: '00:27 · 4K', color: 'amber' },
  { id: 'asset-5', name: '霓虹标题背景', kind: 'image', meta: '2560 × 1440', color: 'magenta' },
  { id: 'asset-6', name: '按键与机械声', kind: 'audio', meta: '00:16 · WAV', color: 'blue' },
]
const defaultAsset = assets[0] as MediaAsset
const kindLabels: Record<AssetKind, string> = { video: '视频', image: '图片', audio: '音频' }

function AssetIcon({ kind }: { kind: AssetKind }) {
  if (kind === 'video') return <Film aria-hidden="true" />
  if (kind === 'image') return <Image aria-hidden="true" />
  return <AudioLines aria-hidden="true" />
}

export function MediaPage() {
  const [view, setView] = useState<'library' | 'canvas'>('library')
  const [filter, setFilter] = useState<'all' | AssetKind>('all')
  const [query, setQuery] = useState('')
  const [selectedAssetId, setSelectedAssetId] = useState(defaultAsset.id)
  const [nodes, setNodes] = useState<CanvasNode[]>([
    { id: 'node-1', assetId: 'asset-1', x: 150, y: 120 },
    { id: 'node-2', assetId: 'asset-2', x: 540, y: 310 },
  ])
  const [zoom, setZoom] = useState(0.8)
  const [pan, setPan] = useState({ x: 40, y: 36 })
  const dragState = useRef<{ type: 'pan' | 'node'; id?: string; startX: number; startY: number; originX: number; originY: number } | null>(null)

  const visibleAssets = useMemo(() => assets.filter((asset) => {
    const matchesKind = filter === 'all' || asset.kind === filter
    return matchesKind && asset.name.toLowerCase().includes(query.trim().toLowerCase())
  }), [filter, query])

  function addSelectedAssetToCanvas() {
    setNodes((current) => [...current, {
      id: `node-${Date.now()}`,
      assetId: selectedAssetId,
      x: 150 + (current.length % 3) * 390,
      y: 120 + Math.floor(current.length / 3) * 280,
    }])
    setView('canvas')
  }
  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragState.current = { type: 'pan', startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y }
  }
  function startNodeDrag(event: ReactPointerEvent<HTMLElement>, node: CanvasNode) {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragState.current = { type: 'node', id: node.id, startX: event.clientX, startY: event.clientY, originX: node.x, originY: node.y }
  }
  function movePointer(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragState.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (drag.type === 'pan') setPan({ x: drag.originX + dx, y: drag.originY + dy })
    else setNodes((current) => current.map((node) => node.id === drag.id ? { ...node, x: drag.originX + dx / zoom, y: drag.originY + dy / zoom } : node))
  }
  function changeZoom(amount: number) { setZoom((current) => Math.min(1.6, Math.max(0.4, Number((current + amount).toFixed(2))))) }

  return (
    <div className="media-workspace">
      <header className="media-workspace__topbar">
        <Link className="media-workspace__exit" to="/" aria-label="返回 Genesis 首页"><ChevronLeft aria-hidden="true" /> G</Link>
        <div className="media-workspace__project"><span>MEDIA / PROJECT</span><strong>未命名影像计划</strong></div>
        <div className="media-workspace__actions"><span>已自动保存</span><button type="button"><Upload aria-hidden="true" /> 导出</button></div>
      </header>
      <aside className="media-workspace__sidebar" aria-label="影音创作功能">
        <button className={view === 'library' ? 'is-active' : ''} type="button" onClick={() => setView('library')}><Library aria-hidden="true" /><span>素材</span></button>
        <button className={view === 'canvas' ? 'is-active' : ''} type="button" onClick={() => setView('canvas')}><Grid2X2 aria-hidden="true" /><span>画布</span></button>
        <span className="media-workspace__sidebar-line" />
        <button disabled type="button"><Film aria-hidden="true" /><span>时间线</span></button>
      </aside>
      <main className="media-workspace__main">
        {view === 'library' ? (
          <section className="asset-library" aria-labelledby="asset-library-title">
            <div className="asset-library__heading">
              <div><p>MEDIA LIBRARY</p><h1 id="asset-library-title">素材库</h1><span>集中管理视频创作中的画面、声音和参考素材。</span></div>
              <button className="media-primary-button" type="button"><Plus aria-hidden="true" /> 导入素材</button>
            </div>
            <div className="asset-library__toolbar">
              <label><Search aria-hidden="true" /><span className="sr-only">搜索素材</span><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索素材" /></label>
              <div role="group" aria-label="素材类型">{(['all', 'video', 'image', 'audio'] as const).map((kind) => <button className={filter === kind ? 'is-active' : ''} key={kind} type="button" onClick={() => setFilter(kind)}>{kind === 'all' ? '全部' : kindLabels[kind]}</button>)}</div>
              <span>{visibleAssets.length} ITEMS</span>
            </div>
            {visibleAssets.length ? <div className="asset-grid">{visibleAssets.map((asset) => (
              <button className={`asset-card ${selectedAssetId === asset.id ? 'is-selected' : ''}`} key={asset.id} type="button" onClick={() => setSelectedAssetId(asset.id)}>
                <span className={`asset-card__preview is-${asset.color}`}><AssetIcon kind={asset.kind} /><i>{kindLabels[asset.kind]}</i></span>
                <span className="asset-card__meta"><strong>{asset.name}</strong><small>{asset.meta}</small></span><span className="asset-card__check" aria-hidden="true">✓</span>
              </button>
            ))}</div> : <div className="asset-library__empty">没有找到匹配的素材。</div>}
            <div className="asset-library__selection"><span>已选择 1 项素材</span><button type="button" onClick={addSelectedAssetToCanvas}>添加到无限画布 <span aria-hidden="true">→</span></button></div>
          </section>
        ) : (
          <section className="infinite-canvas" aria-labelledby="canvas-title">
            <div className="infinite-canvas__bar">
              <div><p>VISUAL CANVAS</p><h1 id="canvas-title">无限画布</h1></div>
              <div className="infinite-canvas__tools" aria-label="画布工具"><button type="button" aria-label="选择工具"><MousePointer2 aria-hidden="true" /></button><button type="button" aria-label="缩小画布" onClick={() => changeZoom(-0.1)}><ZoomOut aria-hidden="true" /></button><output aria-label="当前缩放比例">{Math.round(zoom * 100)}%</output><button type="button" aria-label="放大画布" onClick={() => changeZoom(0.1)}><ZoomIn aria-hidden="true" /></button><button type="button" aria-label="重置画布视图" onClick={() => { setZoom(0.8); setPan({ x: 40, y: 36 }) }}><Maximize2 aria-hidden="true" /></button></div>
              <button className="media-primary-button" type="button" onClick={() => setView('library')}><Plus aria-hidden="true" /> 添加素材</button>
            </div>
            <div className="infinite-canvas__viewport" onPointerDown={startPan} onPointerMove={movePointer} onPointerUp={() => { dragState.current = null }} onPointerCancel={() => { dragState.current = null }}>
              <div className="infinite-canvas__world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>{nodes.map((node) => { const asset = assets.find((item) => item.id === node.assetId) ?? defaultAsset; return <article className="canvas-node" key={node.id} style={{ left: node.x, top: node.y }} onPointerDown={(event) => startNodeDrag(event, node)} onPointerMove={movePointer} onPointerUp={() => { dragState.current = null }}><span className={`canvas-node__preview is-${asset.color}`}><AssetIcon kind={asset.kind} /></span><div><strong>{asset.name}</strong><small>{kindLabels[asset.kind]} · {asset.meta}</small></div></article> })}</div>
              <div className="infinite-canvas__hint">拖动画布浏览 · 拖动卡片整理素材</div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
