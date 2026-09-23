import '@xyflow/react/dist/style.css'

import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  NodeResizer,
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
import { ArrowLeft, ChevronDown, ClipboardPaste, Copy, FileImage, Map as MapIcon, Shapes, StickyNote, Type } from 'lucide-react'
import { api, type Asset, type Document, type Edge, type Node, type Project, upload } from './api'
import { AssetPreview } from './AssetPreview'
import { useCanvas } from './useCanvas'
import { groupSelection, removeSelection, ungroupSelection } from './canvasOperations'

type CanvasNodeData = {
  source: Node
  asset?: Asset
  onTextChange: (id: string, text: string) => void
  onInteractionStart: () => void
  onInteractionEnd: () => void
}

type CanvasFlowNode = FlowNode<CanvasNodeData, Node['type']>

function CanvasNodeView({ id, type, data, selected }: NodeProps<CanvasFlowNode>) {
  const isNote = type === 'note'
  const isText = type === 'text'
  const isShape = type === 'shape'
  const isGroup = type === 'group'
  const label = isNote ? '文字便签' : isText ? '文字节点' : isShape ? '形状节点' : isGroup ? data.source.text || '分组' : data.asset?.name ?? '素材不可用'
  return <article
    aria-label={label}
    className={`media-node ${isNote ? 'is-note' : ''} ${isText ? 'is-text' : ''} ${isShape ? 'is-shape' : ''} ${isGroup ? 'is-group' : ''} ${selected ? 'is-selected' : ''}`}
  >
    <NodeResizer
      color="#dfff82"
      isVisible={selected}
      minWidth={100}
      minHeight={80}
      maxWidth={4000}
      maxHeight={4000}
      onResizeStart={data.onInteractionStart}
      onResizeEnd={data.onInteractionEnd}
    />
    {!isGroup && <Handle type="target" position={Position.Left} aria-label="输入连接点" />}
    <div className="media-node-grip">{isGroup ? <><span>分组 · {data.source.member_ids?.length ?? 0} 个节点</span><input className="nodrag" aria-label="分组名称" value={data.source.text} maxLength={120} onFocus={data.onInteractionStart} onBlur={data.onInteractionEnd} onChange={(event) => data.onTextChange(id, event.target.value)} /></> : label}</div>
    {isNote || isText || isShape
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

const nodeTypes = { asset: CanvasNodeView, note: CanvasNodeView, text: CanvasNodeView, shape: CanvasNodeView, group: CanvasNodeView }

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
  const [draggingFile, setDraggingFile] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
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

  const flowNodes = useMemo<CanvasFlowNode[]>(() => canvas.document.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    selected: selected.includes(node.id),
    zIndex: node.type === 'group' ? -1 : 1,
    dragHandle: '.media-node-grip',
    ariaLabel: node.type === 'note' ? '文字便签' : node.type === 'text' ? '文字节点' : node.type === 'shape' ? '形状节点' : node.type === 'group' ? node.text || '分组' : assets[node.asset_id ?? '']?.name ?? '素材不可用',
    data: {
      source: node,
      asset: assets[node.asset_id ?? ''],
      onTextChange: updateText,
      onInteractionStart: beginInteraction,
      onInteractionEnd: endInteraction,
    },
  })), [assets, beginInteraction, canvas.document.nodes, endInteraction, selected, updateText])

  const flowEdges = useMemo<FlowEdge[]>(() => canvas.document.edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    selected: selectedEdges.includes(edge.id),
    style: { stroke: selectedEdges.includes(edge.id) ? '#dfff82' : '#9993a9', strokeWidth: 2 },
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
      if (event.key === 'Escape') { setMenu(false); setNodeMenu(false); setSelected([]); setSelectedEdges([]) }
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
        const x = origin.x + col * 380
        const y = origin.y + row * 280
        if (!overlaps(x, y)) return { x, y }
      }
    }
    return origin
  }

  function addNode(type: 'note' | 'text' | 'shape') {
    const current = canvas.current.current
    const size = type === 'note' ? { width: 280, height: 220 } : type === 'text' ? { width: 320, height: 150 } : { width: 240, height: 150 }
    const node: Node = { id: crypto.randomUUID(), type, asset_id: null, text: '', ...center(size.width, size.height), ...size }
    canvas.apply({ ...current, nodes: [...current.nodes, node] })
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
    const nextZoom = Math.max(.1, Math.min(4, viewport.zoom * factor))
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
    const nodes = current.nodes
    const rect = canvasElement.current?.getBoundingClientRect()
    if (!rect) return
    if (!nodes.length) {
      canvas.apply({ ...current, viewport: { x: 0, y: 0, zoom: 1 } })
      return
    }
    const left = Math.min(...nodes.map((node) => node.x))
    const top = Math.min(...nodes.map((node) => node.y))
    const right = Math.max(...nodes.map((node) => node.x + node.width))
    const bottom = Math.max(...nodes.map((node) => node.y + node.height))
    const paddingX = Math.min(100, Math.max(32, rect.width * .1))
    const paddingY = Math.min(180, Math.max(100, rect.height * .16))
    const zoom = Math.max(.1, Math.min(2, (rect.width - paddingX * 2) / (right - left), (rect.height - paddingY * 2) / (bottom - top)))
    canvas.apply({
      ...current,
      viewport: {
        zoom,
        x: (rect.width - (right - left) * zoom) / 2 - left * zoom,
        y: (rect.height - (bottom - top) * zoom) / 2 - top * zoom,
      },
    })
  }

  useEffect(() => {
    let width = window.innerWidth
    let timer: number | undefined
    const onResize = () => {
      if (window.innerWidth === width) return
      width = window.innerWidth
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { if (canvas.current.current.nodes.length) fit() }, 160)
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
    {(error || canvas.status.startsWith('保存失败') || canvas.conflict || !canvas.ready) && <div className="media-editor-notice" role="status">{error || canvas.status}<button onClick={() => void action(canvas.ready ? canvas.save : () => canvas.load(true))}>重试</button>{canvas.conflict && <><button onClick={() => { if (window.confirm('放弃本地修改并加载服务器版本？')) void action(() => canvas.load()) }}>重新加载</button><button onClick={() => void action(fork)}>保留为新作品</button></>}<button onClick={() => void navigate(`/media/projects/${projectId}`)}>作品页</button></div>}
    <div ref={canvasElement} className={`media-canvas ${draggingFile ? 'is-file-over' : ''}`} aria-label="作品无限画布" onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDraggingFile(true) } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setDraggingFile(false) }} onDrop={(event) => void importFiles(event)}>
      {canvas.ready && <ReactFlow<CanvasFlowNode>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        viewport={viewport}
        minZoom={.1}
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
      >{canvas.document.background !== 'none' && <Background variant={canvas.document.background === 'lines' ? BackgroundVariant.Lines : BackgroundVariant.Dots} color="#44404e" gap={24} size={1} />}{showMiniMap && !nodeMenu && <MiniMap pannable zoomable position="bottom-right" maskColor="#101116cc" nodeColor={(node) => node.type === 'shape' ? '#dfff82' : node.type === 'note' ? '#e4d9b2' : '#aaa4bd'} />}</ReactFlow>}
      {draggingFile && <div className="media-canvas-drop" aria-hidden="true">松开鼠标，将素材放入画布</div>}
      {uploadProgress !== null && <div className="media-canvas-upload" role="status">正在导入素材 · {uploadProgress}%</div>}
      {canvas.ready && canvas.document.nodes.length === 0 && <div className="media-canvas-empty"><small>A SPACE FOR YOUR IDEAS</small><h1>把第一个想法放上来。</h1><p>添加便签、文字、形状，或从作品素材库放入媒体。</p><div className="media-canvas-empty-actions"><button className="media-accent" onClick={() => setNodeMenu(true)}>＋ 添加节点</button><button onClick={() => void navigate(`/media/projects/${projectId}/assets`)}>打开作品素材库</button></div></div>}
    </div>
    {nodeMenu && <div className="media-node-palette" role="dialog" aria-label="添加节点"><div className="media-node-palette-heading"><strong>添加到画布</strong><button aria-label="关闭节点菜单" onClick={() => setNodeMenu(false)}>×</button></div><button onClick={() => addNode('note')}><StickyNote size={18} /><span><strong>文字便签</strong><small>记录镜头和灵感</small></span></button><button onClick={() => addNode('text')}><Type size={18} /><span><strong>文字节点</strong><small>直接在画布上排版文字</small></span></button><button onClick={() => addNode('shape')}><Shapes size={18} /><span><strong>形状节点</strong><small>制作视觉块和标签</small></span></button><button onClick={() => void navigate(`/media/projects/${projectId}/assets`)}><FileImage size={18} /><span><strong>媒体素材</strong><small>从作品素材库选择</small></span></button></div>}
    {(selected.filter((id) => canvas.document.nodes.some((node) => node.id === id && node.type !== 'group')).length >= 2 || selected.some((id) => canvas.document.nodes.some((node) => node.id === id && node.type === 'group'))) && <div className="media-canvas-selection-actions"><span>已选 {selected.length} 个节点</span><button onClick={groupSelected} disabled={selected.filter((id) => canvas.document.nodes.some((node) => node.id === id && node.type !== 'group')).length < 2}>编组</button><button onClick={ungroupSelected} disabled={!selected.some((id) => canvas.document.nodes.some((node) => node.id === id && node.type === 'group'))}>取消编组</button></div>}
    <div className="media-canvas-toolbar" role="toolbar" aria-label="创作工具"><button className="media-add-node-button" aria-expanded={nodeMenu} disabled={!canvas.ready} onClick={() => { setNodeMenu(!nodeMenu); setMenu(false) }}>＋ 添加节点</button><button disabled={!canvas.ready} onClick={() => void navigate(`/media/projects/${projectId}/assets`)}>素材库</button><button aria-pressed={tool === 'pan'} onClick={() => setTool(tool === 'pan' ? 'select' : 'pan')}>{tool === 'pan' ? '平移' : '选择'}</button><button aria-label="复制节点" title="复制节点 ⌘/Ctrl+C" disabled={!selected.length} onClick={copySelection}><Copy size={16} /></button><button aria-label="粘贴节点" title="粘贴节点 ⌘/Ctrl+V" disabled={clipboardProjectId !== projectId} onClick={pasteSelection}><ClipboardPaste size={16} /></button><button aria-label="撤销" onClick={canvas.undo}>↶</button><button aria-label="重做" onClick={canvas.redo}>↷</button><button disabled={!selected.length && !selectedEdges.length} onClick={removeSelected}>移除</button><button aria-label="切换小地图" aria-pressed={showMiniMap} title="小地图" onClick={() => setShowMiniMap(!showMiniMap)}><MapIcon size={16} /></button><button aria-label="缩小画布" onClick={() => zoom(1 / 1.2)}>−</button><output aria-label="当前缩放比例">{Math.round(viewport.zoom * 100)}%</output><button aria-label="放大画布" onClick={() => zoom(1.2)}>＋</button><button onClick={fit}>适应全部</button></div>
  </main>
}
