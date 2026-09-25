import '@xyflow/react/dist/style.css'

import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ClipboardPaste, Copy, FileImage, Film, Map as MapIcon, Play, Shapes, StickyNote, Type } from 'lucide-react'
import { api, type Asset, type Document, type Edge, type Node, type Project, type VideoFrame, upload } from './api'
import { AssetPreview } from './AssetPreview'
import { useCanvas } from './useCanvas'
import { groupSelection, removeSelection, resizedNodeDimensions, ungroupSelection } from './canvasOperations'

type CanvasNodeData = {
  source: Node
  asset?: Asset
  previewAssets: Asset[]
  frame: VideoFrame
  zoom: number
  onTextChange: (id: string, text: string) => void
  onPatch: (id: string, patch: Partial<Node>, record?: boolean) => void
  onOpenAssets: () => void
  onUploadPreview: (id: string, file: File) => Promise<void>
  onAddConnected: (id: string, side: 'left' | 'right') => void
  onConvertToVideo: (id: string) => void
  onInteractionStart: () => void
  onInteractionEnd: () => void
}

type CanvasFlowNode = FlowNode<CanvasNodeData, Node['type']>

function CanvasResizeCorner({ id, data, minWidth, minHeight, label }: { id: string; data: CanvasNodeData; minWidth: number; minHeight: number; label: string }) {
  const resize = useRef<{ x: number; y: number; width: number; height: number; zoom: number } | null>(null)
  return <button
    className="media-canvas-resize nodrag"
    type="button"
    aria-label={label}
    title="拖动调整节点大小"
    onPointerDown={(event) => {
      event.preventDefault()
      event.stopPropagation()
      resize.current = { x: event.clientX, y: event.clientY, width: data.source.width, height: data.source.height, zoom: data.zoom }
      event.currentTarget.setPointerCapture(event.pointerId)
      data.onInteractionStart()
    }}
    onPointerMove={(event) => {
      if (!resize.current) return
      const start = resize.current
      data.onPatch(id, resizedNodeDimensions(start.width, start.height, event.clientX - start.x, event.clientY - start.y, start.zoom, minWidth, minHeight), false)
    }}
    onPointerUp={(event) => {
      if (!resize.current) return
      resize.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      data.onInteractionEnd()
    }}
    onPointerCancel={() => { resize.current = null; data.onInteractionEnd() }}
  />
}

function VideoNodeView({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.source
  const preview = data.asset && data.asset.kind !== 'audio' ? data.asset : null
  const fileInput = useRef<HTMLInputElement>(null)
  const appendPromptToken = (token: string) => data.onTextChange(id, `${node.text}${node.text ? ' ' : ''}${token}`)
  const aspectRatio = data.frame.width >= data.frame.height ? '16:9' : '9:16'
  const videoQuality = Math.min(data.frame.width, data.frame.height)
  return <article className={`media-video-card ${selected ? 'is-selected' : ''}`} aria-label={node.name || '视频节点'}>
    <CanvasResizeCorner id={id} data={data} minWidth={420} minHeight={470} label="调整视频节点大小" />
    <div className="media-node-grip media-video-grip"><Play size={17} fill="currentColor" aria-hidden="true" /><input className="nodrag" aria-label="视频节点名称" value={node.name ?? ''} maxLength={120} onFocus={data.onInteractionStart} onBlur={data.onInteractionEnd} onChange={(event) => data.onPatch(id, { name: event.target.value }, false)} /></div>
    <div className="media-video-preview-shell">
      <Handle type="target" position={Position.Left} aria-label="连接上一个视频节点" title="点击新建上一段，或拖动连接已有节点" onClick={(event) => { event.stopPropagation(); data.onAddConnected(id, 'left') }} />
      <div className="media-video-screen nodrag nowheel nopan" style={{ aspectRatio: `${data.frame.width} / ${data.frame.height}` }}>
        {preview ? <AssetPreview asset={preview} controls /> : <div className="media-video-placeholder"><Play size={54} fill="currentColor" strokeWidth={0} aria-hidden="true" /><span>从素材开始这一段</span><div><button type="button" onClick={() => fileInput.current?.click()}>导入预览素材</button><button type="button" onClick={data.onOpenAssets}>选择作品素材</button></div></div>}
      </div>
      <Handle type="source" position={Position.Right} aria-label="连接下一个视频节点" title="点击新建下一段，或拖动连接已有节点" onClick={(event) => { event.stopPropagation(); data.onAddConnected(id, 'right') }} />
    </div>
    <section className="media-video-composer nodrag nowheel nopan" aria-label="镜头草稿">
      <div className="media-video-composer-top">
        <button type="button" onClick={data.onOpenAssets}>＋ 参考</button>
        <button type="button" onClick={() => appendPromptToken('【标记】')}>标记</button>
        <button type="button" onClick={() => appendPromptToken('【特效】')}>特效</button>
        <button type="button" onClick={() => appendPromptToken('【角色】')}>角色库</button>
        <button type="button" onClick={() => appendPromptToken('【运镜】')}>运镜</button>
      </div>
      <input ref={fileInput} className="media-video-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime,video/x-matroska" aria-label="导入视频节点预览素材" onChange={(event) => { const file = event.target.files?.[0]; if (file) void data.onUploadPreview(id, file); event.target.value = '' }} />
      <textarea aria-label="镜头描述" value={node.text} placeholder="描述你想要生成的画面内容，@ 引用素材" maxLength={20000} onFocus={data.onInteractionStart} onBlur={data.onInteractionEnd} onChange={(event) => data.onTextChange(id, event.target.value)} />
      <div className="media-video-composer-footer">
        <label className="media-video-asset-picker"><span>预览</span><select aria-label="视频节点预览素材" value={node.asset_id ?? ''} onChange={(event) => data.onPatch(id, { asset_id: event.target.value || null })}><option value="">暂未选择</option>{data.previewAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
        <span className="media-video-spec">{aspectRatio} · {videoQuality}P ·</span><label><select aria-label="镜头时长" value={node.duration_seconds ?? 5} onChange={(event) => data.onPatch(id, { duration_seconds: Number(event.target.value) })}>{[5, 10, 15, 30, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}</select></label><small>草稿</small>
      </div>
    </section>
  </article>
}

function CanvasNodeView({ id, type, data, selected }: NodeProps<CanvasFlowNode>) {
  const [editingEmptyShape, setEditingEmptyShape] = useState(false)
  const isNote = type === 'note'
  const isText = type === 'text'
  const isShape = type === 'shape'
  const isGroup = type === 'group'
  const label = isNote ? '文字便签' : isText ? '文字节点' : isShape ? '形状节点' : isGroup ? data.source.text || '分组' : data.asset?.name ?? '素材不可用'
  return <article
    aria-label={label}
    className={`media-node ${isNote ? 'is-note' : ''} ${isText ? 'is-text' : ''} ${isShape ? 'is-shape' : ''} ${isGroup ? 'is-group' : ''} ${selected ? 'is-selected' : ''}`}
  >
    <CanvasResizeCorner id={id} data={data} minWidth={100} minHeight={80} label="调整节点大小" />
    {!isGroup && <Handle type="target" position={Position.Left} aria-label="输入连接点" />}
    <div className="media-node-grip">{isGroup ? <><span>分组 · {data.source.member_ids?.length ?? 0} 个节点</span><input className="nodrag" aria-label="分组名称" value={data.source.text} maxLength={120} onFocus={data.onInteractionStart} onBlur={data.onInteractionEnd} onChange={(event) => data.onTextChange(id, event.target.value)} /></> : label}</div>
    {isShape && !data.source.text.trim() && !editingEmptyShape
      ? <div className="media-shape-convert nodrag nowheel nopan"><span>这是旧的形状节点</span><button onClick={() => data.onConvertToVideo(id)}>改为视频节点</button><button className="media-shape-edit" onClick={() => setEditingEmptyShape(true)}>保留形状并编辑文字</button></div>
      : isNote || isText || isShape
      ? <textarea
          className="nodrag nowheel nopan"
          aria-label={isNote ? '便签内容' : isText ? '文字内容' : '形状文字'}
          value={data.source.text}
          placeholder={isNote ? '写下镜头、情绪或灵感…' : isText ? '点击这里输入文字…' : '输入形状标签…'}
          maxLength={20000}
          onFocus={data.onInteractionStart}
          onBlur={data.onInteractionEnd}
          onChange={(event) => data.onTextChange(id, event.target.value)}
        />
      : !isGroup && data.asset && <div className="nodrag nowheel nopan media-node-preview"><AssetPreview asset={data.asset} controls /></div>}
    {!isGroup && <Handle type="source" position={Position.Right} aria-label="输出连接点" />}
  </article>
}

const nodeTypes = { asset: CanvasNodeView, note: CanvasNodeView, text: CanvasNodeView, shape: CanvasNodeView, group: CanvasNodeView, video: VideoNodeView }
const framePresets = [
  { label: '横屏 16:9', width: 1920, height: 1080 },
  { label: '竖屏 9:16', width: 1080, height: 1920 },
  { label: '方形 1:1', width: 1080, height: 1080 },
  { label: '社媒 4:5', width: 1080, height: 1350 },
] as const

function documentNode(flowNode: CanvasFlowNode): Node {
  return {
    ...flowNode.data.source,
    x: flowNode.position.x,
    y: flowNode.position.y,
    width: flowNode.width ?? flowNode.measured?.width ?? flowNode.data.source.width,
    height: flowNode.height ?? flowNode.measured?.height ?? flowNode.data.source.height,
  }
}

export function ProjectCanvas({ projectId, userId }: { projectId: string; userId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const canvas = useCanvas(projectId, userId)
  const [project, setProject] = useState<Project | null>(null)
  const [assets, setAssets] = useState<Record<string, Asset>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [selectedEdges, setSelectedEdges] = useState<string[]>([])
  const [clipboardProjectId, setClipboardProjectId] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [nodeMenu, setNodeMenu] = useState(false)
  const [showMiniMap, setShowMiniMap] = useState(false)
  const [frameMenu, setFrameMenu] = useState(false)
  const [frameWidth, setFrameWidth] = useState('1920')
  const [frameHeight, setFrameHeight] = useState('1080')
  const [draggingFile, setDraggingFile] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [previewRetry, setPreviewRetry] = useState<{ id: string; file: File } | null>(null)
  const [tool, setTool] = useState<'select' | 'pan'>('select')
  const [error, setError] = useState('')
  const [flow, setFlow] = useState<ReactFlowInstance<CanvasFlowNode> | null>(null)
  const canvasElement = useRef<HTMLDivElement>(null)
  const interactionActive = useRef(false)
  const viewportActive = useRef(false)
  const importedFromLibrary = useRef<string | null>(null)
  const clipboard = useRef<{ projectId: string; nodes: Node[]; edges: Edge[] } | null>(null)
  const pasteCount = useRef(0)

  const beginInteraction = useCallback(() => {
    if (interactionActive.current) return
    interactionActive.current = true
    canvas.checkpoint()
  }, [canvas])

  const endInteraction = useCallback(() => {
    interactionActive.current = false
  }, [])

  const updateText = useCallback((id: string, text: string) => {
    const current = canvas.current.current
    canvas.apply({
      ...current,
      nodes: current.nodes.map((node) => node.id === id ? { ...node, text } : node),
    }, false)
  }, [canvas])

  const patchNode = useCallback((id: string, patch: Partial<Node>, record = true) => {
    const current = canvas.current.current
    canvas.apply({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) }, record)
  }, [canvas])

  const openAssets = useCallback(() => {
    void canvas.save().then(() => navigate(`/media/projects/${projectId}/assets`)).catch((reason: Error) => setError(reason.message))
  }, [canvas, navigate, projectId])

  const uploadPreview = useCallback(async (id: string, file: File) => {
    setError('')
    setPreviewRetry(null)
    setUploadProgress(0)
    try {
      const asset = await upload(`/projects/${projectId}/assets`, file, setUploadProgress)
      setAssets((previous) => ({ ...previous, [asset.id]: asset }))
      patchNode(id, { asset_id: asset.id })
    } catch (reason) {
      setPreviewRetry({ id, file })
      setError(`预览素材导入失败：${(reason as Error).message}`)
    } finally {
      setUploadProgress(null)
    }
  }, [patchNode, projectId])

  const previewAssets = useMemo(() => Object.values(assets).filter((asset) => asset.kind !== 'audio'), [assets])

  const fittedViewport = useCallback((document: Document) => {
    const nodes = document.nodes
    const rect = canvasElement.current?.getBoundingClientRect()
    if (!rect) return null
    if (!nodes.length) return { x: 0, y: 0, zoom: 1 }
    const left = Math.min(...nodes.map((node) => node.x))
    const top = Math.min(...nodes.map((node) => node.y))
    const right = Math.max(...nodes.map((node) => node.x + node.width))
    const bottom = Math.max(...nodes.map((node) => node.y + node.height))
    const paddingX = Math.min(100, Math.max(32, rect.width * .1))
    const paddingY = Math.min(180, Math.max(100, rect.height * .16))
    const zoom = Math.max(.02, Math.min(2, (rect.width - paddingX * 2) / (right - left), (rect.height - paddingY * 2) / (bottom - top)))
    return {
      zoom,
      x: (rect.width - (right - left) * zoom) / 2 - left * zoom,
      y: (rect.height - (bottom - top) * zoom) / 2 - top * zoom,
    }
  }, [])

  const addConnected = useCallback((id: string, side: 'left' | 'right') => {
    const current = canvas.current.current
    const source = current.nodes.find((node) => node.id === id && node.type === 'video')
    if (!source) return
    const width = source.width
    const height = source.height
    const x = source.x + (side === 'right' ? width + 120 : -width - 120)
    let y = source.y
    const overlaps = (nextX: number, nextY: number) => current.nodes.some((node) => nextX < node.x + node.width + 24 && nextX + width + 24 > node.x && nextY < node.y + node.height + 24 && nextY + height + 24 > node.y)
    while (overlaps(x, y)) y += height + 80
    const node: Node = { id: crypto.randomUUID(), type: 'video', asset_id: null, name: `视频节点 ${current.nodes.filter((item) => item.type === 'video').length + 1}`, duration_seconds: 5, text: '', x, y, width, height }
    const edge: Edge = { id: crypto.randomUUID(), source: side === 'right' ? id : node.id, target: side === 'right' ? node.id : id }
    const next = { ...current, nodes: [...current.nodes, node], edges: [...current.edges, edge] }
    canvas.apply({ ...next, viewport: fittedViewport({ ...next, nodes: [node] }) ?? current.viewport })
    setSelected([node.id])
    setSelectedEdges([])
  }, [canvas, fittedViewport])

  const convertToVideo = useCallback((id: string) => {
    const current = canvas.current.current
    const original = current.nodes.find((node) => node.id === id && node.type === 'shape' && !node.text.trim())
    if (!original) return
    const converted: Node = { ...original, type: 'video', name: `视频节点 ${current.nodes.filter((node) => node.type === 'video').length + 1}`, duration_seconds: 5, width: 820, height: 670 }
    const next = { ...current, nodes: current.nodes.map((node) => node.id === id ? converted : node) }
    canvas.apply({ ...next, viewport: fittedViewport({ ...next, nodes: [converted] }) ?? current.viewport })
    setSelected([id])
    setSelectedEdges([])
  }, [canvas, fittedViewport])

  const flowNodes = useMemo<CanvasFlowNode[]>(() => canvas.document.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    handles: node.type === 'video' ? [
      { type: 'target', position: Position.Left, x: -29, y: node.height / 2 - 92, width: 32, height: 32 },
      { type: 'source', position: Position.Right, x: node.width - 3, y: node.height / 2 - 92, width: 32, height: 32 },
    ] : undefined,
    selected: selected.includes(node.id),
    zIndex: node.type === 'group' ? -1 : 1,
    dragHandle: '.media-node-grip',
    ariaLabel: node.type === 'video' ? node.name || '视频节点' : node.type === 'note' ? '文字便签' : node.type === 'text' ? '文字节点' : node.type === 'shape' ? '形状节点' : node.type === 'group' ? node.text || '分组' : assets[node.asset_id ?? '']?.name ?? '素材不可用',
    data: {
      source: node,
      asset: assets[node.asset_id ?? ''],
      previewAssets,
      frame: canvas.document.frame,
      zoom: canvas.document.viewport.zoom,
      onTextChange: updateText,
      onPatch: patchNode,
      onOpenAssets: openAssets,
      onUploadPreview: uploadPreview,
      onAddConnected: addConnected,
      onConvertToVideo: convertToVideo,
      onInteractionStart: beginInteraction,
      onInteractionEnd: endInteraction,
    },
  })), [addConnected, assets, beginInteraction, canvas.document.frame, canvas.document.nodes, canvas.document.viewport.zoom, convertToVideo, endInteraction, openAssets, patchNode, previewAssets, selected, updateText, uploadPreview])

  const flowEdges = useMemo<FlowEdge[]>(() => canvas.document.edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    selected: selectedEdges.includes(edge.id),
    style: { stroke: selectedEdges.includes(edge.id) ? '#b7c8ce' : '#73828a', strokeWidth: selectedEdges.includes(edge.id) ? 2 : 1.5 },
  })), [canvas.document.edges, selectedEdges])

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

  useEffect(() => {
    void api<Project>(`/projects/${projectId}`)
      .then(async (result) => { setProject(result); await fetchAssets() })
      .catch((reason: Error) => setError(reason.message))
  }, [fetchAssets, projectId])

  useEffect(() => {
    const assetId = new URLSearchParams(location.search).get('addAsset')
    const asset = assetId ? assets[assetId] : undefined
    if (!canvas.ready || !asset || importedFromLibrary.current === asset.id) return
    importedFromLibrary.current = asset.id
    const current = canvas.current.current
    let x = (window.innerWidth / 2 - current.viewport.x) / current.viewport.zoom - 160
    let y = (window.innerHeight / 2 - current.viewport.y) / current.viewport.zoom - 130
    for (let attempts = 0; attempts < 20 && current.nodes.some((node) => Math.abs(node.x - x) < 30 && Math.abs(node.y - y) < 30); attempts++) { x += 40; y += 40 }
    const node: Node = { id: crypto.randomUUID(), type: 'asset', asset_id: asset.id, text: '', x, y, width: 320, height: 260 }
    canvas.apply({ ...current, nodes: [...current.nodes, node] })
    setSelected([node.id])
    void navigate(`/media/projects/${projectId}/canvas`, { replace: true })
  }, [assets, canvas, location.search, navigate, projectId])

  function copySelection() {
    const current = canvas.current.current
    const ids = new Set(selected)
    for (const node of current.nodes) if (node.type === 'group' && ids.has(node.id)) for (const member of node.member_ids ?? []) ids.add(member)
    if (!ids.size) return
    clipboard.current = {
      projectId,
      nodes: current.nodes.filter((node) => ids.has(node.id)),
      edges: current.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    }
    pasteCount.current = 0
    setClipboardProjectId(projectId)
  }

  function pasteSelection() {
    const copied = clipboard.current
    if (!copied?.nodes.length || copied.projectId !== projectId) return
    pasteCount.current += 1
    const offset = 48 * pasteCount.current
    const idMap = new Map(copied.nodes.map((node) => [node.id, crypto.randomUUID()]))
    const nodes = copied.nodes.map((node) => ({ ...node, id: idMap.get(node.id)!, member_ids: node.member_ids?.map((id) => idMap.get(id)!), x: node.x + offset, y: node.y + offset }))
    const edges = copied.edges.map((edge) => ({ id: crypto.randomUUID(), source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }))
    const current = canvas.current.current
    canvas.apply({ ...current, nodes: [...current.nodes, ...nodes], edges: [...current.edges, ...edges] })
    setSelected(nodes.map((node) => node.id))
    setSelectedEdges([])
  }

  function removeSelected() {
    if (!selected.length && !selectedEdges.length) return
    canvas.checkpoint()
    canvas.apply(removeSelection(canvas.current.current, selected, selectedEdges), false)
    setSelected([])
    setSelectedEdges([])
  }

  function groupSelected() {
    const result = groupSelection(canvas.current.current, selected)
    if (!result) { setError('请选择至少两个未分组的节点；分组尺寸不能超过 4000。'); return }
    canvas.apply(result.document)
    setSelected([result.groupId])
    setSelectedEdges([])
    setError('')
  }

  function ungroupSelected() {
    const current = canvas.current.current
    const members = current.nodes.filter((node) => node.type === 'group' && selected.includes(node.id)).flatMap((node) => node.member_ids ?? [])
    if (!members.length) return
    canvas.apply(ungroupSelection(current, selected))
    setSelected(members)
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement
      if (event.key === 'Escape') { setMenu(false); setNodeMenu(false); setFrameMenu(false); setSelected([]); setSelectedEdges([]) }
      if (element.closest('input,textarea,select,button,a,video,audio,[role="dialog"]')) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(canvas.current.current.nodes.map((node) => node.id)) }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); if (event.shiftKey) ungroupSelected(); else groupSelected() }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) canvas.redo(); else canvas.undo()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); canvas.redo() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    const next = applyNodeChanges(changes, flowNodes)
    if (changes.some((change) => change.type === 'select' || change.type === 'remove')) setSelected(next.filter((node) => node.selected).map((node) => node.id))
    const contentChanged = changes.some((change) => change.type === 'remove' || change.type === 'position' && Boolean(change.position) || change.type === 'dimensions' && Boolean(change.setAttributes))
    if (!contentChanged) return
    if (!interactionActive.current) canvas.checkpoint()
    const current = canvas.current.current
    const positions = new Map(next.map((node) => [node.id, node.position]))
    const moved = new Set(changes.flatMap((change) => change.type === 'position' && change.position ? [change.id] : []))
    for (const group of current.nodes.filter((node) => node.type === 'group' && moved.has(node.id))) {
      const position = positions.get(group.id)
      if (!position) continue
      const dx = position.x - group.x
      const dy = position.y - group.y
      for (const member of group.member_ids ?? []) {
        if (moved.has(member)) continue
        const original = current.nodes.find((node) => node.id === member)
        if (original) positions.set(member, { x: original.x + dx, y: original.y + dy })
      }
    }
    const nodes = next.map((node) => ({ ...documentNode(node), x: positions.get(node.id)?.x ?? node.position.x, y: positions.get(node.id)?.y ?? node.position.y }))
    canvas.apply(removeSelection({ ...current, nodes }, [], []), false)
  }, [canvas, flowNodes])

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    const next = applyEdgeChanges(changes, flowEdges)
    if (changes.some((change) => change.type === 'select' || change.type === 'remove')) setSelectedEdges(next.filter((edge) => edge.selected).map((edge) => edge.id))
    if (!changes.some((change) => change.type === 'remove')) return
    const current = canvas.current.current
    canvas.apply({ ...current, edges: next.map(({ id, source, target }) => ({ id, source, target })) })
  }, [canvas, flowEdges])

  const onConnect = useCallback(({ source, target }: Connection) => {
    if (!source || !target || source === target) return
    const current = canvas.current.current
    if (current.nodes.some((node) => (node.id === source || node.id === target) && node.type === 'group')) return
    if (current.edges.some((edge) => edge.source === source && edge.target === target)) return
    canvas.apply({ ...current, edges: [...current.edges, { id: crypto.randomUUID(), source, target }] })
  }, [canvas])

  async function action(fn: () => Promise<void>) {
    setError('')
    try { await fn() } catch (reason) { setError((reason as Error).message) }
  }

  function center(width: number, height: number) {
    const current = canvas.current.current
    const point = flow?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? {
      x: (window.innerWidth / 2 - current.viewport.x) / current.viewport.zoom,
      y: (window.innerHeight / 2 - current.viewport.y) / current.viewport.zoom,
    }
    const origin = { x: point.x - width / 2, y: point.y - height / 2 }
    const overlaps = (x: number, y: number) => current.nodes.some((node) =>
      x < node.x + node.width + 24 && x + width + 24 > node.x &&
      y < node.y + node.height + 24 && y + height + 24 > node.y)
    for (let ring = 0; ring < 30; ring++) {
      const slots: [number, number][] = ring === 0 ? [[0, 0]] : [[ring, 0], [-ring, 0], [0, ring], [0, -ring], [ring, ring], [-ring, ring], [ring, -ring], [-ring, -ring]]
      for (const [col, row] of slots) {
        const x = origin.x + col * Math.max(380, width + 80)
        const y = origin.y + row * Math.max(280, height + 80)
        if (!overlaps(x, y)) return { x, y }
      }
    }
    return origin
  }

  function addNode(type: 'video' | 'note' | 'text' | 'shape') {
    const current = canvas.current.current
    const size = type === 'video' ? { width: 820, height: 670 } : type === 'note' ? { width: 280, height: 220 } : type === 'text' ? { width: 320, height: 150 } : { width: 240, height: 150 }
    const name = type === 'video' ? `视频节点 ${current.nodes.filter((item) => item.type === 'video').length + 1}` : ''
    const node: Node = { id: crypto.randomUUID(), type, asset_id: null, name, duration_seconds: 5, text: '', ...center(size.width, size.height), ...size }
    const next = { ...current, nodes: [...current.nodes, node] }
    canvas.apply(type === 'video' ? { ...next, viewport: fittedViewport({ ...next, nodes: [node] }) ?? current.viewport } : next)
    setSelected([node.id])
    setNodeMenu(false)
  }

  async function importFiles(event: DragEvent) {
    event.preventDefault()
    setDraggingFile(false)
    const files = [...event.dataTransfer.files]
    if (!files.length) return
    setError('')
    const point = flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? center(320, 260)
    try {
      for (const [index, file] of files.entries()) {
        setUploadProgress(0)
        const asset = await upload(`/projects/${projectId}/assets`, file, setUploadProgress)
        setAssets((previous) => ({ ...previous, [asset.id]: asset }))
        const node: Node = { id: crypto.randomUUID(), type: 'asset', asset_id: asset.id, text: '', x: point.x + index * 36, y: point.y + index * 36, width: 320, height: 260 }
        const current = canvas.current.current
        canvas.apply({ ...current, nodes: [...current.nodes, node] })
        setSelected([node.id])
      }
    } catch (reason) { setError(`素材导入失败：${(reason as Error).message}`) }
    finally { setUploadProgress(null) }
  }

  function updateViewport(viewport: Viewport) {
    const current = canvas.current.current
    if (current.viewport.x === viewport.x && current.viewport.y === viewport.y && current.viewport.zoom === viewport.zoom) return
    canvas.apply({ ...current, viewport }, false)
  }

  function zoom(factor: number) {
    const current = canvas.current.current
    const viewport = current.viewport
    const nextZoom = Math.max(.02, Math.min(4, viewport.zoom * factor))
    const centerX = window.innerWidth / 2
    const centerY = window.innerHeight / 2
    canvas.apply({
      ...current,
      viewport: {
        zoom: nextZoom,
        x: centerX - (centerX - viewport.x) * nextZoom / viewport.zoom,
        y: centerY - (centerY - viewport.y) * nextZoom / viewport.zoom,
      },
    })
  }

  function fit() {
    const current = canvas.current.current
    const viewport = fittedViewport(current)
    if (viewport) canvas.apply({ ...current, viewport })
  }

  function applyFrame(frame: VideoFrame) {
    if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 256 || frame.height < 256 || frame.width > 8192 || frame.height > 8192) {
      setError('画幅宽高必须是 256–8192 之间的整数像素。')
      return
    }
    const next = { ...canvas.current.current, frame }
    canvas.apply(next)
    setFrameWidth(String(frame.width))
    setFrameHeight(String(frame.height))
    setError('')
  }

  useEffect(() => {
    let width = window.innerWidth
    let timer: number | undefined
    const onResize = () => {
      if (window.innerWidth === width) return
      width = window.innerWidth
      window.clearTimeout(timer)
      timer = window.setTimeout(fit, 160)
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); window.clearTimeout(timer) }
  })

  async function fork() {
    const newProject = await api<Project>('/projects', 'POST', { name: `${project?.name ?? '作品'}（本地副本）`.slice(0, 120) })
    const ids = [...new Set(canvas.current.current.nodes.flatMap((node) => node.asset_id ? [node.asset_id] : []))]
    await api(`/projects/${projectId}/copy-assets/${newProject.id}`, 'POST', { asset_ids: ids })
    await api(`/projects/${newProject.id}/canvas`, 'PUT', { version: 0, document: canvas.current.current })
    void navigate(`/media/projects/${newProject.id}/canvas`)
  }

  const viewport = canvas.document.viewport
  return <main className="media-editor">
    <div className="media-project-menu"><div className="media-project-controls"><button className="media-project-back" aria-label="返回作品页" title="返回作品页" onClick={() => void action(async () => { await canvas.save(); void navigate(`/media/projects/${projectId}`) })}><ArrowLeft size={17} /></button><button className="media-project-trigger" aria-expanded={menu} aria-label="作品菜单" onClick={() => { setMenu(!menu); setNodeMenu(false) }}><span className="media-project-name">{project?.name ?? '作品'}</span><ChevronDown size={15} /></button></div>{menu && <div className="media-menu-content"><p role="status">{canvas.status}</p><label className="media-background-setting">画布背景<select aria-label="画布背景" value={canvas.document.background} onChange={(event) => canvas.apply({ ...canvas.current.current, background: event.target.value as Document['background'] })}><option value="dots">点阵</option><option value="lines">网格</option><option value="none">纯色</option></select></label><button onClick={() => void action(async () => { await canvas.save(); void navigate(`/media/projects/${projectId}/assets`) })}>作品素材库</button><button onClick={() => { const name = window.prompt('作品名称', project?.name); if (name?.trim()) void action(async () => { setProject(await api<Project>(`/projects/${projectId}`, 'PATCH', { name })) }) }}>重命名作品</button><button onClick={() => void action(canvas.save)}>立即保存 / 重试</button></div>}</div>
    <div className="media-frame-control"><button className="media-frame-trigger" aria-expanded={frameMenu} aria-label="视频画幅设置" disabled={!canvas.ready} onClick={() => { if (!frameMenu) { setFrameWidth(String(canvas.document.frame.width)); setFrameHeight(String(canvas.document.frame.height)) }; setFrameMenu(!frameMenu); setMenu(false); setNodeMenu(false) }}>视频规格 <strong>{canvas.document.frame.width} × {canvas.document.frame.height}</strong><ChevronDown size={14} /></button>{frameMenu && <section className="media-frame-panel" role="dialog" aria-label="视频画幅设置"><div className="media-frame-panel-heading"><strong>视频规格</strong><button aria-label="关闭画幅设置" onClick={() => setFrameMenu(false)}>×</button></div><p>设定视频节点的预览比例与标注尺寸，不影响素材文件。</p><div className="media-frame-presets">{framePresets.map((preset) => <button key={preset.label} aria-pressed={canvas.document.frame.width === preset.width && canvas.document.frame.height === preset.height} onClick={() => applyFrame(preset)}>{preset.label}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); applyFrame({ width: Number(frameWidth), height: Number(frameHeight) }) }}><div className="media-frame-dimensions"><label>宽度 · px<input aria-label="画幅宽度" type="number" min="256" max="8192" step="1" value={frameWidth} onChange={(event) => setFrameWidth(event.target.value)} /></label><span>×</span><label>高度 · px<input aria-label="画幅高度" type="number" min="256" max="8192" step="1" value={frameHeight} onChange={(event) => setFrameHeight(event.target.value)} /></label></div><button className="media-accent" type="submit">应用尺寸</button></form><button className="media-frame-fit" onClick={fit}>适应全部节点</button></section>}</div>
    {(error || canvas.status.startsWith('保存失败') || canvas.conflict || !canvas.ready) && <div className="media-editor-notice" role="status">{error || canvas.status}{previewRetry && error.startsWith('预览素材导入失败') ? <button onClick={() => void uploadPreview(previewRetry.id, previewRetry.file)}>重试上传</button> : <button onClick={() => void action(canvas.ready ? canvas.save : () => canvas.load(true))}>重试</button>}{canvas.conflict && <><button onClick={() => { if (window.confirm('放弃本地修改并加载服务器版本？')) void action(() => canvas.load()) }}>重新加载</button><button onClick={() => void action(fork)}>保留为新作品</button></>}<button onClick={() => void navigate(`/media/projects/${projectId}`)}>作品页</button></div>}
    <div ref={canvasElement} className={`media-canvas ${draggingFile ? 'is-file-over' : ''}`} aria-label="作品无限画布" onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDraggingFile(true) } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setDraggingFile(false) }} onDrop={(event) => void importFiles(event)}>
      {canvas.ready && <ReactFlow<CanvasFlowNode>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        viewport={viewport}
        minZoom={.02}
        maxZoom={4}
        nodesConnectable
        selectionOnDrag={tool === 'select'}
        selectionMode={SelectionMode.Partial}
        panOnDrag={tool === 'pan' ? [0, 1, 2] : [1, 2]}
        panOnScroll
        panActivationKeyCode="Space"
        zoomOnScroll={false}
        zoomActivationKeyCode={['Meta', 'Control']}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        deleteKeyCode={null}
        onInit={setFlow}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={beginInteraction}
        onNodeDragStop={endInteraction}
        onMoveStart={() => { if (!viewportActive.current) { viewportActive.current = true; canvas.checkpoint() } }}
        onMove={(_, next) => updateViewport(next)}
        onMoveEnd={(_, next) => { viewportActive.current = false; updateViewport(next) }}
        proOptions={{ hideAttribution: true }}
      >{canvas.document.background !== 'none' && <Background variant={canvas.document.background === 'lines' ? BackgroundVariant.Lines : BackgroundVariant.Dots} color="#3a444b" gap={24} size={1} />}{showMiniMap && !nodeMenu && <MiniMap pannable zoomable position="bottom-right" maskColor="#101116cc" nodeColor={(node) => node.type === 'video' ? '#7b8a92' : node.type === 'shape' ? '#8298a3' : node.type === 'note' ? '#758992' : '#687981'} />}</ReactFlow>}
      {draggingFile && <div className="media-canvas-drop" aria-hidden="true">松开鼠标，将素材放入画布</div>}
      {uploadProgress !== null && <div className="media-canvas-upload" role="status">正在导入素材 · {uploadProgress}%</div>}
      {canvas.ready && canvas.document.nodes.length === 0 && !frameMenu && !nodeMenu && <div className="media-canvas-empty"><small>视频创作空间</small><h1>从第一个镜头开始。</h1><p>创建视频节点，添加素材、描述画面，再连接下一段。</p><div className="media-canvas-empty-actions"><button className="media-accent" onClick={() => addNode('video')}>＋ 添加视频节点</button><button onClick={() => void navigate(`/media/projects/${projectId}/assets`)}>打开作品素材库</button></div></div>}
    </div>
    {nodeMenu && <div className="media-node-palette" role="dialog" aria-label="添加节点"><div className="media-node-palette-heading"><strong>添加到画布</strong><button aria-label="关闭节点菜单" onClick={() => setNodeMenu(false)}>×</button></div><button onClick={() => addNode('video')}><Film size={18} /><span><strong>视频节点</strong><small>预览、镜头描述与连接</small></span></button><button onClick={() => addNode('note')}><StickyNote size={18} /><span><strong>文字便签</strong><small>记录镜头和灵感</small></span></button><button onClick={() => addNode('text')}><Type size={18} /><span><strong>文字节点</strong><small>直接在画布上排版文字</small></span></button><button onClick={() => addNode('shape')}><Shapes size={18} /><span><strong>形状节点</strong><small>制作视觉块和标签</small></span></button><button onClick={() => void navigate(`/media/projects/${projectId}/assets`)}><FileImage size={18} /><span><strong>媒体素材</strong><small>从作品素材库选择</small></span></button></div>}
    {(selected.filter((id) => canvas.document.nodes.some((node) => node.id === id && node.type !== 'group')).length >= 2 || selected.some((id) => canvas.document.nodes.some((node) => node.id === id && node.type === 'group'))) && <div className="media-canvas-selection-actions"><span>已选 {selected.length} 个节点</span><button onClick={groupSelected} disabled={selected.filter((id) => canvas.document.nodes.some((node) => node.id === id && node.type !== 'group')).length < 2}>编组</button><button onClick={ungroupSelected} disabled={!selected.some((id) => canvas.document.nodes.some((node) => node.id === id && node.type === 'group'))}>取消编组</button></div>}
    <div className="media-canvas-toolbar" role="toolbar" aria-label="创作工具"><button className="media-add-node-button" aria-expanded={nodeMenu} disabled={!canvas.ready} onClick={() => { setNodeMenu(!nodeMenu); setMenu(false) }}>＋ 添加节点</button><button disabled={!canvas.ready} onClick={() => void navigate(`/media/projects/${projectId}/assets`)}>素材库</button><button aria-pressed={tool === 'pan'} onClick={() => setTool(tool === 'pan' ? 'select' : 'pan')}>{tool === 'pan' ? '平移' : '选择'}</button><button aria-label="复制节点" title="复制节点 ⌘/Ctrl+C" disabled={!selected.length} onClick={copySelection}><Copy size={16} /></button><button aria-label="粘贴节点" title="粘贴节点 ⌘/Ctrl+V" disabled={clipboardProjectId !== projectId} onClick={pasteSelection}><ClipboardPaste size={16} /></button><button aria-label="撤销" onClick={canvas.undo}>↶</button><button aria-label="重做" onClick={canvas.redo}>↷</button><button disabled={!selected.length && !selectedEdges.length} onClick={removeSelected}>移除</button><button aria-label="切换小地图" aria-pressed={showMiniMap} title="小地图" onClick={() => setShowMiniMap(!showMiniMap)}><MapIcon size={16} /></button><button aria-label="缩小画布" onClick={() => zoom(1 / 1.2)}>−</button><output aria-label="当前缩放比例">{Math.round(viewport.zoom * 100)}%</output><button aria-label="放大画布" onClick={() => zoom(1.2)}>＋</button><button onClick={fit}>适应全部</button></div>
  </main>
}
