import type { Document, Node } from './api'
import { syncReferenceModes } from './canvasReferences'

export const generationNodeSize = { width: 640, height: 402 }

// 旧 video 类型继续表示生视频节点，避免把已有提示词节点误转为素材。
export const isGenerationNode = (node: Pick<Node, 'type'>) => node.type === 'video' || node.type === 'image_generation' || node.type === 'audio_generation'
export const nodeTypeLabel = (type: Node['type']) => ({ video: '生视频节点', image_generation: '生图节点', audio_generation: '生音频节点', video_asset: '视频节点', image: '图片节点', audio: '音频节点', asset: '素材节点', note: '便签', text: '文本', shape: '形状', group: '分组' })[type]
export const audioAssetNodeSize = { width: 360, height: 88 }

export function normalizeCanvasNodePresets(document: Document): Document {
  document = syncReferenceModes(document)
  let changed = false
  const nodes = document.nodes.map((node) => {
    if (node.type === 'audio' && node.width === 360 && node.height === 230) {
      changed = true
      return { ...node, ...audioAssetNodeSize, y: node.y + (node.height - audioAssetNodeSize.height) / 2 }
    }
    if (!isGenerationNode(node)) return node
    const preset = node.width === 820 && node.height === 670 || node.width === 480 && node.height === 312
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
    text: '新分组', x: left - 30, y: top - 54, width: right - left + 60, height: bottom - top + 84,
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
