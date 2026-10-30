import { defaultGenerationSettings, type Asset, type Document, type Node } from './api'

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

// 空图片节点也保留为待就绪参考，防止尚未生成时悄悄改成文生图。
export function imageReferences(references: ReturnType<typeof incomingReferences>) {
  return references.filter(({ node, asset }) => asset ? asset.kind === 'image' : Boolean(node.asset_id) || node.type === 'image' || node.type === 'image_generation')
}

export function connectReference(document: Document, source: string, target: string): Document {
  const origin = document.nodes.find(node => node.id === source)
  const destination = document.nodes.find(node => node.id === target)
  if (!origin || !destination || source === target || origin.type === 'group' || destination.type === 'group') throw new Error('参考连线的来源或目标已失效，未修改画布。')
  if (document.edges.some(edge => edge.source === source && edge.target === target)) return document
  return syncReferenceModes({
    ...document,
    edges: [...document.edges, { id: crypto.randomUUID(), source, target }],
  })
}

export function syncReferenceModes(document: Document): Document {
  const materials = new Set(document.nodes.filter(node => node.asset_id || ['image', 'image_generation', 'video', 'video_asset', 'audio', 'audio_generation'].includes(node.type)).map(node => node.id))
  const targets = new Set(document.edges.filter(edge => edge.source !== edge.target && materials.has(edge.source)).map(edge => edge.target))
  const nodes = document.nodes.map<Node>(node => {
    if (node.type !== 'video' && node.type !== 'audio_generation') return node
    const mode = targets.has(node.id) ? node.generation?.mode === 'first_last' ? 'first_last' : 'reference' : 'text'
    return (node.generation?.mode ?? 'text') === mode ? node : { ...node, generation: { ...defaultGenerationSettings(), ...node.generation, mode } }
  })
  return nodes.some((node, index) => node !== document.nodes[index]) ? { ...document, nodes } : document
}

// 引用绑定节点标识，显示名称和图片序号均可随画布更新，不把序号当作永久身份。
export const imageMentionToken = (nodeId: string) => `@[图片](ref:${nodeId})`
export const imageMentionPattern = /@\[图片\]\(ref:([a-zA-Z0-9_-]+)\)/g

export function imageReferenceNumbers(references: ReturnType<typeof incomingReferences>) {
  const images: string[] = []
  return new Map(imageReferences(references).map(({ node, asset }) => {
    const identity = asset?.id ?? node.asset_id ?? node.id
    if (!images.includes(identity)) images.push(identity)
    return [node.id, images.indexOf(identity) + 1]
  }))
}

export function displayPrompt(text: string, references: ReturnType<typeof incomingReferences>) {
  const numbers = imageReferenceNumbers(references)
  return text.replace(imageMentionPattern, (_token, id: string) => {
    const number = numbers.get(id)
    return number === undefined ? '@已断开图片' : `@图片${number}`
  })
}
