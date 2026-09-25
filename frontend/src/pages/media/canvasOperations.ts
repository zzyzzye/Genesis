import type { Document, Node } from './api'

export function resizedVideoDimensions(width: number, height: number, deltaX: number, deltaY: number, zoom: number) {
  const scale = Math.max(.02, zoom)
  return {
    width: Math.max(420, Math.min(4000, width + deltaX / scale)),
    height: Math.max(470, Math.min(4000, height + deltaY / scale)),
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
  return { ...document, nodes, edges: document.edges.filter((edge) => remaining.has(edge.source) && remaining.has(edge.target) && !removedEdges.has(edge.id)) }
}
