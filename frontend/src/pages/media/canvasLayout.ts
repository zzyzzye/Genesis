import { Graph, graphlib, layout, type GraphLabel, type NodeLabel, type OrderConstraint } from '@dagrejs/dagre'
import type { Document, Node } from './api'

type ExpandedEditor = { id: string; height: number }

// 只计算位置；连线顺序同时决定图片引用编号，排版不能重建或排序连线。
export function arrangeCanvas(document: Document, editor?: ExpandedEditor): Document {
  if (!document.nodes.length) return document
  const byId = new Map(document.nodes.map(node => [node.id, node]))
  const owners = new Map<string, string>()
  for (const group of document.nodes.filter(node => node.type === 'group')) {
    for (const id of group.member_ids ?? []) {
      if (byId.has(id) && byId.get(id)?.type !== 'group') owners.set(id, group.id)
    }
  }
  // 分组作为整体参与外部布局，成员仅平移，不拆散创作者已经整理的内容。
  const blocks = document.nodes.filter(node => !owners.has(node.id)).map(node => {
    const members = node.type === 'group'
      ? [node, ...document.nodes.filter(member => owners.get(member.id) === node.id)] : [node]
    const left = Math.min(...members.map(member => member.x)) - 16
    const top = Math.min(...members.map(member => member.y)) - 40
    const right = Math.max(...members.map(member => member.x + member.width)) + 16
    const bottom = Math.max(...members.map(member => member.y + member.height + (editor?.id === member.id ? editor.height + 14 : 0))) + 40
    return { node, members, left, top, width: right - left, height: bottom - top }
  }).sort((a, b) => a.top - b.top || a.left - b.left || a.node.id.localeCompare(b.node.id))
  const graph = new Graph<GraphLabel, NodeLabel>()
    .setGraph({ rankdir: 'LR', ranksep: 220, nodesep: 100, marginx: 80, marginy: 80 })
    .setDefaultEdgeLabel(() => ({}))
  for (const block of blocks) graph.setNode(block.node.id, { width: block.width, height: block.height })
  const incoming = new Map<string, string[]>()
  for (const edge of document.edges) {
    const source = owners.get(edge.source) ?? edge.source
    const target = owners.get(edge.target) ?? edge.target
    if (source !== target && graph.hasNode(source) && graph.hasNode(target)) {
      graph.setEdge(source, target)
      const sources = incoming.get(target) ?? []
      if (!sources.includes(source)) sources.push(source)
      incoming.set(target, sources)
    }
  }
  // 用引擎原生顺序约束保持参考编号的上下次序；多个目标顺序冲突时保留先出现的关系。
  const order = new Graph<Record<string, never>, Record<string, never>, Record<string, never>>()
  const constraints: OrderConstraint[] = []
  for (const sources of incoming.values()) for (let index = 1; index < sources.length; index++) {
    const left = sources[index - 1]!, right = sources[index]!
    if (order.hasEdge(left, right)) continue
    order.setEdge(left, right)
    if (graphlib.alg.isAcyclic(order)) constraints.push({ left, right })
    else order.removeEdge(left, right)
  }
  layout(graph, { constraints })
  const positions = new Map<string, { x: number; y: number }>()
  for (const block of blocks) {
    const position = graph.node(block.node.id)
    const dx = (position.x ?? NaN) - block.width / 2 - block.left
    const dy = (position.y ?? NaN) - block.height / 2 - block.top
    for (const member of block.members) {
      const x = Math.round(member.x + dx)
      const y = Math.round(member.y + dy)
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1000000 || Math.abs(y) > 1000000) throw new Error('节点尺寸或数量超出排版范围，请先调整节点尺寸。')
      positions.set(member.id, { x, y })
    }
  }
  const nodes = document.nodes.map<Node>(node => {
    const position = positions.get(node.id)
    return position && (position.x !== node.x || position.y !== node.y) ? { ...node, ...position } : node
  })
  return nodes.some((node, index) => node !== document.nodes[index]) ? { ...document, nodes } : document
}
