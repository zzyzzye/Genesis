import type { Asset, Document, Node } from './api'

/** 一次遍历建立入边索引，保留连线顺序并过滤失效、自连和重复引用。 */
export function indexCanvasReferences(nodes: Node[], edges: Document['edges'], assets: Record<string, Asset>) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const incoming = new Map<string, Set<string>>()
  const references = new Map<string, { node: Node; asset: Asset | undefined }[]>()
  for (const edge of edges) {
    const source = byId.get(edge.source)
    if (!source || source.type === 'group' || edge.source === edge.target || !byId.has(edge.target)) continue
    const ids = incoming.get(edge.target) ?? new Set<string>()
    if (ids.has(source.id)) continue
    ids.add(source.id)
    incoming.set(edge.target, ids)
    const entries = references.get(edge.target) ?? []
    entries.push({ node: source, asset: source.asset_id ? assets[source.asset_id] : undefined })
    references.set(edge.target, entries)
  }
  return { incoming, references }
}

const sameArray = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((item, index) => item === b[index])
const shallowEqual = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key])

/** 复用未改变节点的 data 和 Flow 对象，使框架与 memo 节点跳过无关更新。 */
export function createCanvasNodeReconciler<T extends {
  id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number }
  handles?: unknown[]
  data: Record<string, unknown> & { references: { node: Node; asset?: Asset }[]; referenceCandidates: Node[] }
}>() {
  let previous = new Map<string, T>()
  return (nodes: T[]): T[] => {
    const next = nodes.map(node => {
      const old = previous.get(node.id)
      if (!old) return node
      if (sameArray(old.data.referenceCandidates, node.data.referenceCandidates)) node.data.referenceCandidates = old.data.referenceCandidates
      if (old.data.references.length === node.data.references.length && old.data.references.every((entry, index) => entry.node === node.data.references[index]?.node && entry.asset === node.data.references[index]?.asset)) node.data.references = old.data.references
      if (shallowEqual(old.data, node.data)) node.data = old.data
      if (old.position.x === node.position.x && old.position.y === node.position.y) node.position = old.position
      if (old.measured?.width === node.measured?.width && old.measured?.height === node.measured?.height) node.measured = old.measured
      // 连接点只由节点类型和尺寸推导，不受坐标、选择与编辑状态影响。
      if (old.measured === node.measured && (old as Record<string, unknown>).type === (node as Record<string, unknown>).type) node.handles = old.handles
      return shallowEqual(old, node) ? old : node
    })
    previous = new Map(next.map(node => [node.id, node]))
    return next
  }
}
