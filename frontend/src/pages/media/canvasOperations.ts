import { applyNodeChanges, type NodeChange, type Node as FlowNode } from '@xyflow/react'
import type { Document, Node } from './api'
import { promptMentionPattern, syncReferenceModes } from './canvasReferences'

export const generationNodeSize = { width: 600, height: 378 }

// 旧 video 类型继续表示生视频节点，避免把已有提示词节点误转为素材。
export const isGenerationNode = (node: Pick<Node, 'type'>) => node.type === 'video' || node.type === 'image_generation' || node.type === 'audio_generation'
export const nodeTypeLabel = (type: Node['type']) => ({ video: '生视频节点', image_generation: '生图节点', audio_generation: '生音频节点', video_asset: '视频节点', image: '图片节点', audio: '音频节点', asset: '素材节点', note: '便签', text: '文本', shape: '形状', group: '分组' })[type]
export const audioAssetNodeSize = { width: 360, height: 88 }

export function duplicateCanvasSelection(document: Document, selected: string[], offset = { x: 48, y: 48 }) {
  const ids = new Set(selected)
  for (const node of document.nodes) if (node.type === 'group' && ids.has(node.id)) for (const member of node.member_ids ?? []) ids.add(member)
  const originals = document.nodes.filter(node => ids.has(node.id))
  const idMap = new Map(originals.map(node => [node.id, crypto.randomUUID()]))
  const nodes = originals.map(node => ({ ...node, id: idMap.get(node.id)!, name: `${node.name || nodeTypeLabel(node.type)} - 副本`.slice(0, 120),
    text: node.text.replace(promptMentionPattern, (token, kind: string, id: string) => idMap.has(id) ? `@[${kind}](ref:${idMap.get(id)!})` : token),
    member_ids: node.member_ids?.flatMap(id => idMap.has(id) ? [idMap.get(id)!] : []), x: node.x + offset.x, y: node.y + offset.y }))
  // 上游参考沿用原节点；内部关系改接副本，不向原有下游新增输出线。
  const edges = document.edges.filter(edge => idMap.has(edge.target)).map(edge => ({ id: crypto.randomUUID(), source: idMap.get(edge.source) ?? edge.source, target: idMap.get(edge.target)! }))
  return { document: syncReferenceModes({ ...document, nodes: [...document.nodes, ...nodes], edges: [...document.edges, ...edges] }), idMap }
}

export function applyCanvasNodeChanges(document: Document, changes: NodeChange<FlowNode>[]): Document {
  // 仅从最新文档投影几何信息，不用上一帧的节点重建正文、尺寸或异步生成结果。
  const next = applyNodeChanges(changes, document.nodes.map((node) => ({ id: node.id, position: { x: node.x, y: node.y }, width: node.width, height: node.height, data: {} })))
  const positions = new Map(next.map((node) => [node.id, node.position]))
  const moved = new Set(changes.flatMap((change) => change.type === 'position' && change.position ? [change.id] : []))
  for (const group of document.nodes.filter((node) => node.type === 'group' && moved.has(node.id))) {
    const position = positions.get(group.id)
    if (!position) continue
    for (const member of group.member_ids ?? []) {
      if (moved.has(member)) continue
      const original = document.nodes.find((node) => node.id === member)
      if (original) positions.set(member, { x: original.x + position.x - group.x, y: original.y + position.y - group.y })
    }
  }
  const latest = new Map(document.nodes.map((node) => [node.id, node]))
  const nodes = next.flatMap((node) => {
    const original = latest.get(node.id)
    if (!original) return []
    const position = positions.get(node.id) ?? node.position
    const width = node.width ?? original.width
    const height = node.height ?? original.height
    return original.x === position.x && original.y === position.y && original.width === width && original.height === height
      ? [original] : [{ ...original, ...position, width, height }]
  })
  if (nodes.length === document.nodes.length && nodes.every((node, index) => node === document.nodes[index])) return document
  const result = { ...document, nodes }
  return changes.some((change) => change.type === 'remove') ? removeSelection(result, [], []) : result
}

export function defaultNodeName(type: Node['type'], nodes: readonly Pick<Node, 'name'>[]): string {
  const names = new Set(nodes.map((node) => node.name?.trim()))
  let index = 1
  while (names.has(`${nodeTypeLabel(type)} ${index}`)) index += 1
  return `${nodeTypeLabel(type)} ${index}`
}

export function normalizeCanvasNodeNames(document: Document): Document {
  const named = document.nodes.filter((node) => node.name?.trim())
  let changed = false
  const nodes = document.nodes.map((node) => {
    if (node.name?.trim()) return node
    // 旧分组把标题存在正文中；迁移名称时保留原正文，避免破坏旧草稿。
    const name = (node.type === 'group' ? node.text.trim().slice(0, 120) : '') || defaultNodeName(node.type, named)
    const next = { ...node, name }
    named.push(next)
    changed = true
    return next
  })
  return changed ? { ...document, nodes } : document
}

export function normalizeCanvasNodePresets(document: Document): Document {
  document = normalizeCanvasNodeNames(syncReferenceModes(document))
  let changed = false
  const nodes = document.nodes.map((node) => {
    if (node.type === 'audio' && node.width === 360 && node.height === 230) {
      changed = true
      return { ...node, ...audioAssetNodeSize, y: node.y + (node.height - audioAssetNodeSize.height) / 2 }
    }
    if (!isGenerationNode(node)) return node
    const preset = node.width === 820 && node.height === 670 || node.width === 480 && node.height === 312 || node.width === 640 && node.height === 402
    const name = node.type === 'video' ? node.name?.replace(/^视频节点(\s+\d+)?$/, '生视频节点$1') : node.name
    if (!preset && name === node.name) return node
    changed = true
    // 只迁移旧默认规格，保持中心、连接和用户手动调整的尺寸。
    return preset ? { ...node, name, ...generationNodeSize, x: node.x + (node.width - generationNodeSize.width) / 2, y: node.y + (node.height - generationNodeSize.height) / 2 } : { ...node, name }
  })
  return changed ? { ...document, nodes } : document
}

export function resizedNodeDimensions(width: number, height: number, deltaX: number, deltaY: number, zoom: number, minWidth: number, minHeight: number) {
  const scale = Math.max(.02, zoom)
  return {
    width: Math.max(minWidth, Math.min(4000, width + deltaX / scale)),
    height: Math.max(minHeight, Math.min(4000, height + deltaY / scale)),
  }
}

export function groupSelection(document: Document, selected: string[]): { document: Document; groupId: string } | null {
  const selectedIds = new Set(selected)
  const groupedIds = new Set(document.nodes.flatMap((node) => node.type === 'group' ? node.member_ids ?? [] : []))
  const members = document.nodes.filter((node) => selectedIds.has(node.id) && node.type !== 'group' && !groupedIds.has(node.id))
  if (members.length < 2) return null
  const left = Math.min(...members.map((node) => node.x))
  const top = Math.min(...members.map((node) => node.y))
  const right = Math.max(...members.map((node) => node.x + node.width))
  const bottom = Math.max(...members.map((node) => node.y + node.height))
  if (right - left + 60 > 4000 || bottom - top + 84 > 4000) return null
  const group: Node = {
    id: crypto.randomUUID(), type: 'group', asset_id: null, member_ids: members.map((node) => node.id),
    name: defaultNodeName('group', document.nodes), text: '', x: left - 30, y: top - 54, width: right - left + 60, height: bottom - top + 84,
  }
  return { document: { ...document, nodes: [group, ...document.nodes] }, groupId: group.id }
}

export function ungroupSelection(document: Document, selected: string[]): Document {
  const ids = new Set(selected)
  const nodes = document.nodes.filter((node) => node.type !== 'group' || !ids.has(node.id))
  const remaining = new Set(nodes.map((node) => node.id))
  return { ...document, nodes, edges: document.edges.filter((edge) => remaining.has(edge.source) && remaining.has(edge.target)) }
}

export function removeSelection(document: Document, selectedNodes: string[], selectedEdges: string[]): Document {
  const removed = new Set(selectedNodes)
  const removedEdges = new Set(selectedEdges)
  let nodes = document.nodes.filter((node) => !removed.has(node.id)).map((node) => node.type === 'group'
    ? { ...node, member_ids: (node.member_ids ?? []).filter((id) => !removed.has(id)) }
    : node)
  nodes = nodes.filter((node) => node.type !== 'group' || (node.member_ids?.length ?? 0) >= 2)
  const remaining = new Set(nodes.map((node) => node.id))
  return syncReferenceModes({ ...document, nodes, edges: document.edges.filter((edge) => remaining.has(edge.source) && remaining.has(edge.target) && !removedEdges.has(edge.id)) })
}
