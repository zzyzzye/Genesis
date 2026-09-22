import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Asset, type Node, type Project } from './api'
import { AssetLibrary } from './AssetLibrary'
import { AssetPreview } from './AssetPreview'
import { useCanvas } from './useCanvas'

type Gesture = { type: 'pan' | 'move' | 'resize' | 'box'; x: number; y: number; nodes: Node[]; ids: string[]; viewport: { x: number; y: number; zoom: number } }

export function ProjectCanvas({ projectId, userId }: { projectId: string; userId: string }) {
  const navigate = useNavigate()
  const canvas = useCanvas(projectId, userId)
  const [project, setProject] = useState<Project | null>(null)
  const [assets, setAssets] = useState<Record<string, Asset>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [menu, setMenu] = useState(false)
  const [library, setLibrary] = useState(false)
  const [tool, setTool] = useState<'select' | 'pan'>('select')
  const [error, setError] = useState('')
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const space = useRef(false)
  const gesture = useRef<Gesture | null>(null)
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('textarea,video,audio')) return
      event.preventDefault()
      const v = canvas.current.current.viewport
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect()
        const zoom = Math.max(.1, Math.min(4, v.zoom * Math.exp(-event.deltaY * .005)))
        const x = event.clientX - rect.left; const y = event.clientY - rect.top
        canvas.apply({ ...canvas.current.current, viewport: { zoom, x: x - (x - v.x) * zoom / v.zoom, y: y - (y - v.y) * zoom / v.zoom } }, false)
      } else canvas.apply({ ...canvas.current.current, viewport: { ...v, x: v.x - event.deltaX, y: v.y - event.deltaY } }, false)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [canvas])
  const fetchAssets = useCallback(async () => {
    const all: Asset[] = []
    let page = 1
    while (true) {
      const result = await api<{ items: Asset[]; total: number }>(`/projects/${projectId}/assets?page=${page}&page_size=100`)
      all.push(...result.items)
      if (all.length >= result.total) break
      page++
    }
    setAssets(Object.fromEntries(all.map((asset) => [asset.id, asset])))
  }, [projectId])
  useEffect(() => { void api<Project>(`/projects/${projectId}`).then(async (result) => { setProject(result); await fetchAssets() }).catch((reason: Error) => setError(reason.message)) }, [fetchAssets, projectId])
  const removeSelected = useCallback(() => {
    canvas.apply({ ...canvas.current.current, nodes: canvas.current.current.nodes.filter((node) => !selected.includes(node.id)) }); setSelected([])
  }, [canvas, selected])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement
      if (element.closest('input,textarea,select,button,a,video,audio,[role="dialog"]')) return
      if (event.code === 'Space') { event.preventDefault(); space.current = true }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) canvas.redo(); else canvas.undo() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); canvas.redo() }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected() }
      if (event.key === 'Escape') { setSelected([]); setLibrary(false); setMenu(false) }
      const delta = event.shiftKey ? 20 : 2
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selected.length) {
        event.preventDefault()
        canvas.apply({ ...canvas.current.current, nodes: canvas.current.current.nodes.map((node) => selected.includes(node.id) ? { ...node, x: node.x + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0), y: node.y + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0) } : node) })
      }
    }
    const up = () => { space.current = false }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', up) }
  }, [canvas, removeSelected, selected])
  async function action(fn: () => Promise<void>) { setError(''); try { await fn() } catch (reason) { setError((reason as Error).message) } }
  function center() {
    const rect = viewport.current?.getBoundingClientRect(); const v = canvas.current.current.viewport
    let x = ((rect?.width ?? 800) / 2 - v.x) / v.zoom - 150
    let y = ((rect?.height ?? 600) / 2 - v.y) / v.zoom - 110
    for (let attempts = 0; attempts < 20 && canvas.current.current.nodes.some((node) => Math.abs(node.x - x) < 30 && Math.abs(node.y - y) < 30); attempts++) { x += 40; y += 40 }
    return { x, y }
  }
  function addNote() { const node: Node = { id: crypto.randomUUID(), type: 'note', asset_id: null, text: '', ...center(), width: 280, height: 220 }; canvas.apply({ ...canvas.current.current, nodes: [...canvas.current.current.nodes, node] }); setSelected([node.id]) }
  async function addAsset(asset: Asset) {
    await api(`/projects/${projectId}/assets/reference`, 'POST', { asset_id: asset.id })
    setAssets((current) => ({ ...current, [asset.id]: asset }))
    const node: Node = { id: crypto.randomUUID(), type: 'asset', asset_id: asset.id, text: '', ...center(), width: 320, height: 260 }
    canvas.apply({ ...canvas.current.current, nodes: [...canvas.current.current.nodes, node] }); setSelected([node.id]); setLibrary(false)
  }
  function start(event: ReactPointerEvent<HTMLElement>, type: Gesture['type'], id?: string) {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    event.stopPropagation()
    const mode = space.current || tool === 'pan' || event.button === 1 ? 'pan' : type
    let ids = selected
    if (id && mode !== 'pan') { ids = event.shiftKey ? selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id] : selected.includes(id) ? selected : [id]; setSelected(ids) }
    else if (mode === 'box') setSelected([])
    canvas.checkpoint()
    gesture.current = { type: mode, x: event.clientX, y: event.clientY, nodes: canvas.current.current.nodes, ids, viewport: canvas.current.current.viewport }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus()
  }
  function move(event: ReactPointerEvent<HTMLElement>) {
    const drag = gesture.current
    if (!drag) return
    const dx = event.clientX - drag.x; const dy = event.clientY - drag.y
    const v = drag.viewport
    if (drag.type === 'pan') canvas.apply({ ...canvas.current.current, viewport: { ...v, x: v.x + dx, y: v.y + dy } }, false)
    else if (drag.type === 'box') {
      const rect = viewport.current?.getBoundingClientRect(); if (!rect) return
      const selection = { x: Math.min(drag.x, event.clientX) - rect.left, y: Math.min(drag.y, event.clientY) - rect.top, width: Math.abs(dx), height: Math.abs(dy) }; setBox(selection)
      setSelected(drag.nodes.filter((node) => node.x * v.zoom + v.x < selection.x + selection.width && (node.x + node.width) * v.zoom + v.x > selection.x && node.y * v.zoom + v.y < selection.y + selection.height && (node.y + node.height) * v.zoom + v.y > selection.y).map((node) => node.id))
    } else canvas.apply({ ...canvas.current.current, nodes: drag.nodes.map((node) => drag.ids.includes(node.id) ? drag.type === 'move' ? { ...node, x: Math.max(-1000000, Math.min(1000000, node.x + dx / v.zoom)), y: Math.max(-1000000, Math.min(1000000, node.y + dy / v.zoom)) } : { ...node, width: Math.max(100, Math.min(4000, node.width + dx / v.zoom)), height: Math.max(80, Math.min(4000, node.height + dy / v.zoom)) } : node) }, false)
  }
  function finish() { gesture.current = null; setBox(null) }
  function zoom(factor: number) {
    const rect = viewport.current?.getBoundingClientRect(); const v = canvas.current.current.viewport; const next = Math.max(.1, Math.min(4, v.zoom * factor)); const x = (rect?.width ?? 800) / 2; const y = (rect?.height ?? 600) / 2
    canvas.apply({ ...canvas.current.current, viewport: { zoom: next, x: x - (x - v.x) * next / v.zoom, y: y - (y - v.y) * next / v.zoom } })
  }
  function fit() {
    const nodes = canvas.current.current.nodes; const rect = viewport.current?.getBoundingClientRect()
    if (!nodes.length || !rect) { canvas.apply({ ...canvas.current.current, viewport: { x: 0, y: 0, zoom: 1 } }); return }
    const x = Math.min(...nodes.map((node) => node.x)); const y = Math.min(...nodes.map((node) => node.y)); const right = Math.max(...nodes.map((node) => node.x + node.width)); const bottom = Math.max(...nodes.map((node) => node.y + node.height)); const scale = Math.max(.1, Math.min(2, (rect.width - 100) / (right - x), (rect.height - 180) / (bottom - y)))
    canvas.apply({ ...canvas.current.current, viewport: { zoom: scale, x: (rect.width - (right - x) * scale) / 2 - x * scale, y: (rect.height - (bottom - y) * scale) / 2 - y * scale } })
  }
  async function fork() {
    const newProject = await api<Project>('/projects', 'POST', { name: `${project?.name ?? '作品'}（本地副本）`.slice(0, 120) })
    const ids = [...new Set(canvas.current.current.nodes.flatMap((node) => node.asset_id ? [node.asset_id] : []))]
    // 复制作品时显式共享原始文件，避免隐式将私有素材加入账户库。
    await api(`/projects/${projectId}/copy-assets/${newProject.id}`, 'POST', { asset_ids: ids })
    await api(`/projects/${newProject.id}/canvas`, 'PUT', { version: 0, document: canvas.current.current })
    void navigate(`/media/projects/${newProject.id}`)
  }
  const v = canvas.document.viewport
  return <main className="media-editor">
    <div className="media-project-menu"><button aria-expanded={menu} onClick={() => setMenu(!menu)}>{project?.name ?? '作品'} <span>⌄</span></button>{menu && <div className="media-menu-content"><p role="status">{canvas.status}</p><button onClick={() => void action(async () => { await canvas.save(); await canvas.save(); void navigate('/media') })}>← 返回作品列表</button><button onClick={() => { const name = window.prompt('作品名称', project?.name); if (name?.trim()) void action(async () => { setProject(await api<Project>(`/projects/${projectId}`, 'PATCH', { name })) }) }}>重命名作品</button><button onClick={() => void action(canvas.save)}>立即保存 / 重试</button></div>}</div>
    {(error || canvas.status.startsWith('保存失败') || canvas.conflict || !canvas.ready) && <div className="media-editor-notice" role="status">{error || canvas.status}<button onClick={() => void action(canvas.ready ? canvas.save : () => canvas.load(true))}>重试</button>{canvas.conflict && <><button onClick={() => { if (window.confirm('放弃本地修改并加载服务器版本？')) void action(() => canvas.load()) }}>重新加载</button><button onClick={() => void action(fork)}>保留为新作品</button></>}<button onClick={() => void navigate('/media')}>作品列表</button></div>}
    <div ref={viewport} className="media-canvas" tabIndex={0} aria-label="作品无限画布" onPointerDown={(event) => start(event, 'box')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} style={{ backgroundPosition: `${v.x}px ${v.y}px`, backgroundSize: `${24 * v.zoom}px ${24 * v.zoom}px` }}>
      {canvas.ready && canvas.document.nodes.length === 0 && <div className="media-canvas-empty"><small>A SPACE FOR YOUR IDEAS</small><h1>把第一个想法放上来。</h1><p>打开素材库，或添加一张文字便签。</p></div>}
      <div className="media-canvas-world" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.zoom})` }}>{canvas.document.nodes.map((node) => <article key={node.id} tabIndex={0} aria-label={node.type === 'note' ? '文字便签' : assets[node.asset_id ?? '']?.name ?? '素材'} className={`media-node ${node.type === 'note' ? 'is-note' : ''} ${selected.includes(node.id) ? 'is-selected' : ''}`} style={{ left: node.x, top: node.y, width: node.width, height: node.height }} onPointerDown={(event) => start(event, 'move', node.id)} onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === 'Enter') {
          event.preventDefault()
          setSelected((current) => event.shiftKey ? current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id] : [node.id])
        }
      }}>
        <div className="media-node-grip">{node.type === 'note' ? '文字便签' : assets[node.asset_id ?? '']?.name ?? '素材不可用'}</div>
        {node.type === 'note' ? <textarea aria-label="便签内容" value={node.text} placeholder="写下镜头、情绪或灵感…" maxLength={20000} onPointerDown={(event) => event.stopPropagation()} onFocus={() => canvas.checkpoint()} onChange={(event) => canvas.apply({ ...canvas.current.current, nodes: canvas.current.current.nodes.map((item) => item.id === node.id ? { ...item, text: event.target.value } : item) }, false)} /> : assets[node.asset_id ?? ''] && <AssetPreview asset={assets[node.asset_id ?? ''] as Asset} controls />}
        {selected.includes(node.id) && <button className="media-resize" aria-label="调整节点尺寸" onPointerDown={(event) => start(event, 'resize', node.id)} onKeyDown={(event) => { if (event.key.startsWith('Arrow')) { event.preventDefault(); canvas.apply({ ...canvas.current.current, nodes: canvas.current.current.nodes.map((item) => item.id === node.id ? { ...item, width: Math.max(100, Math.min(4000, item.width + (event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0))), height: Math.max(80, Math.min(4000, item.height + (event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0))) } : item) }) } }}>↘</button>}
      </article>)}</div>{box && <div className="media-selection-box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} />}
    </div>
    <div className="media-canvas-toolbar" role="toolbar" aria-label="创作工具"><button disabled={!canvas.ready} aria-expanded={library} onClick={() => setLibrary(!library)}>素材</button><button disabled={!canvas.ready} onClick={addNote}>便签 ＋</button><button aria-pressed={tool === 'pan'} onClick={() => setTool(tool === 'pan' ? 'select' : 'pan')}>{tool === 'pan' ? '平移' : '选择'}</button><button aria-label="撤销" onClick={canvas.undo}>↶</button><button aria-label="重做" onClick={canvas.redo}>↷</button><button disabled={!selected.length} onClick={removeSelected}>移除</button><button aria-label="缩小画布" onClick={() => zoom(1 / 1.2)}>−</button><output aria-label="当前缩放比例">{Math.round(v.zoom * 100)}%</output><button aria-label="放大画布" onClick={() => zoom(1.2)}>＋</button><button onClick={fit}>适应全部</button></div>
    {library && <AssetLibrary projectId={projectId} beforeRemove={async () => { await canvas.save(); await canvas.save() }} onClose={() => { setLibrary(false); viewport.current?.focus() }} onAdd={addAsset} onRemoved={async () => { await canvas.load(); await fetchAssets(); setSelected([]) }} />}
  </main>
}
