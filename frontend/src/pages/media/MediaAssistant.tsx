import './CanvasAssistant.css'
import { Check, Clapperboard, WandSparkles, X } from 'lucide-react'
import { useState } from 'react'
import { AgentAssistant } from '../../features/agent/AgentAssistant'
import { accountAuthTokenKey } from '../../lib/auth'

type MediaAssistantPage = 'projects' | 'project' | 'canvas' | 'assets'
export type MediaAssistantNode = { id: string; type: string; name: string; text: string; assetId: string | null }
type MediaCanvasOperation =
  | { action: 'add_video'; name: string; text: string; duration_seconds: number; connect_from_id?: string }
  | { action: 'add_image'; name: string; text: string }
  | { action: 'add_audio'; name: string; text: string }
  | { action: 'add_note'; text: string }
  | { action: 'update_node'; node_id: string; name?: string; text?: string; duration_seconds?: number }
export type MediaCanvasPlan = { title: string; operations: MediaCanvasOperation[] }

const promptsByPage: Record<MediaAssistantPage, string[]> = {
  projects: ['把一句想法拆成短片方案', '给我一个可拍的 6 镜头结构'],
  project: ['为这部作品规划镜头节奏', '列出还需要补齐的素材'],
  canvas: ['把当前想法拆成分镜并添加到画布', '检查镜头节奏与转场'],
  assets: ['给素材库一套命名与分组规则', '根据现有素材列拍摄补充清单'],
}
const pageLabels: Record<MediaAssistantPage, string> = { projects: '作品列表', project: '作品概览', canvas: '创作画布', assets: '素材库' }
const nodeTypeLabels: Record<string, string> = { video: '生视频节点', image_generation: '生图节点', audio_generation: '生音频节点', video_asset: '视频节点', image: '图片节点', audio: '音频节点', note: '便签', text: '文本', shape: '形状', asset: '素材', group: '分组' }

function nodeLabel(node: MediaAssistantNode) { return node.name.trim() || node.text.trim().slice(0, 24) || nodeTypeLabels[node.type] || '节点' }
function canvasPlanFromMessage(content: string): MediaCanvasPlan | null {
  const match = content.match(/```canvas-plan\s*\n?([\s\S]*?)```/i)
  if (!match) return null
  try {
    const candidate = JSON.parse(match[1] ?? '') as { title?: unknown; operations?: unknown }
    if (!Array.isArray(candidate.operations) || candidate.operations.length === 0 || candidate.operations.length > 8) return null
    const operations: MediaCanvasOperation[] = []
    for (const item of candidate.operations) {
      if (!item || typeof item !== 'object') return null
      const operation = item as Record<string, unknown>
      const action = operation.action
      if (action === 'add_video' && typeof operation.name === 'string' && typeof operation.text === 'string') {
        operations.push({ action, name: operation.name.slice(0, 120), text: operation.text.slice(0, 2000), duration_seconds: Math.max(1, Math.min(60, Math.round(Number(operation.duration_seconds)) || 5)), ...(typeof operation.connect_from_id === 'string' ? { connect_from_id: operation.connect_from_id } : {}) })
      } else if ((action === 'add_image' || action === 'add_audio') && typeof operation.name === 'string' && typeof operation.text === 'string') {
        operations.push({ action, name: operation.name.slice(0, 120), text: operation.text.slice(0, 2000) })
      } else if (action === 'add_note' && typeof operation.text === 'string') {
        operations.push({ action, text: operation.text.slice(0, 2000) })
      } else if (action === 'update_node' && typeof operation.node_id === 'string') {
        const patch = { action, node_id: operation.node_id, ...(typeof operation.name === 'string' ? { name: operation.name.slice(0, 120) } : {}), ...(typeof operation.text === 'string' ? { text: operation.text.slice(0, 2000) } : {}), ...(typeof operation.duration_seconds === 'number' && Number.isFinite(operation.duration_seconds) ? { duration_seconds: Math.max(1, Math.min(60, Math.round(operation.duration_seconds))) } : {}) } as MediaCanvasOperation
        if (!('name' in patch) && !('text' in patch) && !('duration_seconds' in patch)) return null
        operations.push(patch)
      } else return null
    }
    return { title: typeof candidate.title === 'string' ? candidate.title.slice(0, 80) : '镜头搭档方案', operations }
  } catch { return null }
}
function planSummary(plan: MediaCanvasPlan) {
  const videos = plan.operations.filter((item) => item.action === 'add_video').length
  const images = plan.operations.filter((item) => item.action === 'add_image').length
  const audios = plan.operations.filter((item) => item.action === 'add_audio').length
  const notes = plan.operations.filter((item) => item.action === 'add_note').length
  const updates = plan.operations.filter((item) => item.action === 'update_node').length
  return [videos && `新增 ${videos} 个镜头`, images && `新增 ${images} 张图片`, audios && `新增 ${audios} 段音频`, notes && `新增 ${notes} 条便签`, updates && `更新 ${updates} 个节点`].filter(Boolean).join(' · ')
}

export function MediaAssistant({ userId, attachmentsAllowed, page, projectId, selectedNode, onApplyCanvasPlan }: {
  userId: string
  attachmentsAllowed: boolean
  page: MediaAssistantPage
  projectId?: string
  selectedNode: MediaAssistantNode | null
  onApplyCanvasPlan?: (plan: MediaCanvasPlan) => void
}) {
  const [appliedPlans, setAppliedPlans] = useState<Set<string>>(() => new Set())
  const [dismissedNodeId, setDismissedNodeId] = useState<string | null>(null)
  const discussionNode = selectedNode?.id === dismissedNodeId ? null : selectedNode
  return <AgentAssistant userId={userId} page={{ route: window.location.pathname, section: 'media', pageType: 'section' }} editor={null} media={{
    name: '镜头搭档',
    subtitle: '构思 · 分镜 · 编排',
    authKey: accountAuthTokenKey,
    attachmentsAllowed,
    className: page === 'canvas' ? 'media-assistant--canvas' : '',
    contextLabel: discussionNode ? <><span>正在讨论 · {nodeLabel(discussionNode)}</span><button className="media-assistant__dismiss-node" type="button" aria-label="移除当前讨论节点" onClick={() => setDismissedNodeId(discussionNode.id)}><X aria-hidden="true" /></button></> : `当前页面：${pageLabels[page]}`,
    context: {
      module: 'media', route: window.location.pathname, page_type: page,
      selected_node: discussionNode ? { id: discussionNode.id, type: discussionNode.type, name: discussionNode.name, text: discussionNode.text, asset_id: discussionNode.assetId } : undefined,
      page: { project_id: projectId ?? null, area: pageLabels[page] },
    },
    suggestions: promptsByPage[page],
    welcome: <><Clapperboard aria-hidden="true" /><span>镜头与叙事</span><h2>{selectedNode ? '接着这个镜头，往下想。' : page === 'assets' ? '整理素材，再开始拍。' : '下一段，怎么拍？'}</h2><p>{selectedNode ? '细化画面、调整节奏，或继续编排下一个镜头。' : page === 'canvas' ? '写下故事想法，或选中画布上的镜头一起讨论。' : page === 'assets' ? '讨论素材命名、分组与需要补充的画面。' : '从一句想法开始，一起规划故事、镜头与素材。'}</p></>,
    renderResponse: (content, key, disabled) => {
      const plan = canvasPlanFromMessage(content)
      if (!plan || page !== 'canvas' || !onApplyCanvasPlan) return null
      const applied = appliedPlans.has(key)
      return <div className="media-assistant__plan"><strong><WandSparkles aria-hidden="true" />{plan.title}</strong><p>{planSummary(plan)}</p><button type="button" disabled={applied || disabled} onClick={() => { onApplyCanvasPlan(plan); setAppliedPlans(current => new Set(current).add(key)) }}>{applied ? <><Check aria-hidden="true" />已应用</> : '应用到画布'}</button></div>
    },
  }} />
}
