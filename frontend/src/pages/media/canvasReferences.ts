import type { Asset, Document } from './api'

// 只读取直接连入的节点，避免环形连线重复展开或隐式传递无关素材。
export function incomingReferences(document: Document, nodeId: string, assets: Record<string, Asset>) {
  const sourceIds = new Set(document.edges.filter((edge) => edge.target === nodeId && edge.source !== nodeId).map((edge) => edge.source))
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  // 按连线建立顺序显示，节点拖动和图层顺序变化不会改变参考顺序。
  return [...sourceIds].flatMap((id) => {
    const node = nodes.get(id)
    return node && node.type !== 'group' ? [{ node, asset: node.asset_id ? assets[node.asset_id] : undefined }] : []
  })
}
