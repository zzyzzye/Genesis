import '@xyflow/react/dist/style.css'

import {
  Background,
  NodeResizer,
  ReactFlow,
  SelectionMode,
  applyNodeChanges,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, type Asset, type Node, type Project } from './api'
import { AssetPreview } from './AssetPreview'
import { useCanvas } from './useCanvas'

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
  return <article
    aria-label={isNote ? '文字便签' : data.asset?.name ?? '素材不可用'}
    className={`media-node ${isNote ? 'is-note' : ''} ${selected ? 'is-selected' : ''}`}
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
    <div className="media-node-grip">{isNote ? '文字便签' : data.asset?.name ?? '素材不可用'}</div>
    {isNote
      ? <textarea
          className="nodrag nowheel nopan"
          aria-label="便签内容"
          value={data.source.text}
          placeholder="写下镜头、情绪或灵感…"
          maxLength={20000}
          onFocus={data.onInteractionStart}
          onBlur={data.onInteractionEnd}
          onChange={(event) => data.onTextChange(id, event.target.value)}
        />
      : data.asset && <div className="nodrag nowheel nopan media-node-preview"><AssetPreview asset={data.asset} controls /></div>}
  </article>
}

const nodeTypes = { asset: CanvasNodeView, note: CanvasNodeView }

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
  const [menu, setMenu] = useState(false)
  const [tool, setTool] = useState<'select' | 'pan'>('select')
  const [error, setError] = useState('')
  const [flow, setFlow] = useState<ReactFlowInstance<CanvasFlowNode> | null>(null)
  const canvasElement = useRef<HTMLDivElement>(null)
  const interactionActive = useRef(false)
  const viewportActive = useRef(false)
  const importedFromLibrary = useRef<string | null>(null)

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
    dragHandle: '.media-node-grip',
    ariaLabel: node.type === 'note' ? '文字便签' : assets[node.asset_id ?? '']?.name ?? '素材不可用',
    data: {
      source: node,
      asset: assets[node.asset_id ?? ''],
      onTextChange: updateText,
      onInteractionStart: beginInteraction,
      onInteractionEnd: endInteraction,
    },
  })), [assets, beginInteraction, canvas.document.nodes, endInteraction, selected, updateText])

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

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement
      if (element.closest('input,textarea,select,button,a,video,audio,[role="dialog"]')) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) canvas.redo(); else canvas.undo()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); canvas.redo() }
      if (event.key === 'Escape') setMenu(false)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [canvas])

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    const next = applyNodeChanges(changes, flowNodes)
    if (changes.some((change) => change.type === 'select' || change.type === 'remove')) setSelected(next.filter((node) => node.selected).map((node) => node.id))
    const contentChanged = changes.some((change) => change.type === 'remove' || change.type === 'position' && Boolean(change.position) || change.type === 'dimensions' && Boolean(change.setAttributes))
    if (!contentChanged) return
    if (!interactionActive.current) canvas.checkpoint()
    const current = canvas.current.current
    canvas.apply({ ...current, nodes: next.map(documentNode) }, false)
  }, [canvas, flowNodes])

  const removeSelected = useCallback(() => {
    if (!selected.length) return
    canvas.checkpoint()
    const current = canvas.current.current
    canvas.apply({ ...current, nodes: current.nodes.filter((node) => !selected.includes(node.id)) }, false)
    setSelected([])
  }, [canvas, selected])

  async function action(fn: () => Promise<void>) {
    setError('')
    try { await fn() } catch (reason) { setError((reason as Error).message) }
  }

  function center() {
    const current = canvas.current.current
    let position = flow?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? {
      x: (window.innerWidth / 2 - current.viewport.x) / current.viewport.zoom,
      y: (window.innerHeight / 2 - current.viewport.y) / current.viewport.zoom,
    }
    position = { x: position.x - 140, y: position.y - 110 }
    for (let attempts = 0; attempts < 20 && current.nodes.some((node) => Math.abs(node.x - position.x) < 30 && Math.abs(node.y - position.y) < 30); attempts++) position = { x: position.x + 40, y: position.y + 40 }
    return position
  }

  function addNote() {
    const current = canvas.current.current
    const node: Node = { id: crypto.randomUUID(), type: 'note', asset_id: null, text: '', ...center(), width: 280, height: 220 }
    canvas.apply({ ...current, nodes: [...current.nodes, node] })
    setSelected([node.id])
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

  async function fork() {
    const newProject = await api<Project>('/projects', 'POST', { name: `${project?.name ?? '作品'}（本地副本）`.slice(0, 120) })
    const ids = [...new Set(canvas.current.current.nodes.flatMap((node) => node.asset_id ? [node.asset_id] : []))]
    await api(`/projects/${projectId}/copy-assets/${newProject.id}`, 'POST', { asset_ids: ids })
    await api(`/projects/${newProject.id}/canvas`, 'PUT', { version: 0, document: canvas.current.current })
    void navigate(`/media/projects/${newProject.id}/canvas`)
  }

  const viewport = canvas.document.viewport
  return <main className="media-editor">
    <div className="media-project-menu"><button aria-expanded={menu} onClick={() => setMenu(!menu)}>{project?.name ?? '作品'} <span>⌄</span></button>{menu && <div className="media-menu-content"><p role="status">{canvas.status}</p><button onClick={() => void action(async () => { await canvas.save(); await canvas.save(); void navigate(`/media/projects/${projectId}`) })}>← 返回作品页</button><button onClick={() => void action(async () => { await canvas.save(); await canvas.save(); void navigate(`/media/projects/${projectId}/assets`) })}>作品素材库</button><button onClick={() => { const name = window.prompt('作品名称', project?.name); if (name?.trim()) void action(async () => { setProject(await api<Project>(`/projects/${projectId}`, 'PATCH', { name })) }) }}>重命名作品</button><button onClick={() => void action(canvas.save)}>立即保存 / 重试</button></div>}</div>
    {(error || canvas.status.startsWith('保存失败') || canvas.conflict || !canvas.ready) && <div className="media-editor-notice" role="status">{error || canvas.status}<button onClick={() => void action(canvas.ready ? canvas.save : () => canvas.load(true))}>重试</button>{canvas.conflict && <><button onClick={() => { if (window.confirm('放弃本地修改并加载服务器版本？')) void action(() => canvas.load()) }}>重新加载</button><button onClick={() => void action(fork)}>保留为新作品</button></>}<button onClick={() => void navigate(`/media/projects/${projectId}`)}>作品页</button></div>}
    <div ref={canvasElement} className="media-canvas" aria-label="作品无限画布">
      {canvas.ready && <ReactFlow<CanvasFlowNode>
        nodes={flowNodes}
        edges={[]}
        nodeTypes={nodeTypes}
        viewport={viewport}
        minZoom={.1}
        maxZoom={4}
        nodesConnectable={false}
        selectionOnDrag={tool === 'select'}
        selectionMode={SelectionMode.Partial}
        panOnDrag={tool === 'pan' ? [0, 1, 2] : [1, 2]}
        panOnScroll
        panActivationKeyCode="Space"
        zoomOnScroll={false}
        zoomActivationKeyCode={['Meta', 'Control']}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        deleteKeyCode={['Backspace', 'Delete']}
        onInit={setFlow}
        onNodesChange={onNodesChange}
        onNodeDragStart={beginInteraction}
        onNodeDragStop={endInteraction}
        onMoveStart={() => { if (!viewportActive.current) { viewportActive.current = true; canvas.checkpoint() } }}
        onMove={(_, next) => updateViewport(next)}
        onMoveEnd={(_, next) => { viewportActive.current = false; updateViewport(next) }}
        proOptions={{ hideAttribution: true }}
      ><Background color="#44404e" gap={24} size={1} /></ReactFlow>}
      {canvas.ready && canvas.document.nodes.length === 0 && <div className="media-canvas-empty"><small>A SPACE FOR YOUR IDEAS</small><h1>把第一个想法放上来。</h1><p>从这部作品的素材开始，或先记下一张便签。</p><button className="media-accent" onClick={() => void navigate(`/media/projects/${projectId}/assets`)}>打开作品素材库</button></div>}
    </div>
    <div className="media-canvas-toolbar" role="toolbar" aria-label="创作工具"><button disabled={!canvas.ready} onClick={() => void navigate(`/media/projects/${projectId}/assets`)}>素材库</button><button disabled={!canvas.ready} onClick={addNote}>便签 ＋</button><button aria-pressed={tool === 'pan'} onClick={() => setTool(tool === 'pan' ? 'select' : 'pan')}>{tool === 'pan' ? '平移' : '选择'}</button><button aria-label="撤销" onClick={canvas.undo}>↶</button><button aria-label="重做" onClick={canvas.redo}>↷</button><button disabled={!selected.length} onClick={removeSelected}>移除</button><button aria-label="缩小画布" onClick={() => zoom(1 / 1.2)}>−</button><output aria-label="当前缩放比例">{Math.round(viewport.zoom * 100)}%</output><button aria-label="放大画布" onClick={() => zoom(1.2)}>＋</button><button onClick={fit}>适应全部</button></div>
  </main>
}
