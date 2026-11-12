import './CanvasAssistant.css'
import { Clapperboard, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AiToolCall } from '../../lib/api'
import { AgentAssistant } from '../../features/agent/AgentAssistant'
import { accountAuthTokenKey } from '../../lib/auth'
import type { Document, GenerationSettings } from './api'

type MediaAssistantPage = 'projects' | 'project' | 'canvas' | 'assets'
export type MediaGenerationResource = NonNullable<AiToolCall['resource']>
export type MediaCanvasActions = { readOnly?: boolean; save: () => Promise<void>; getDocument: () => Document; attachImageTask: (resource: MediaGenerationResource) => Promise<void>; syncNodeNames?: () => Promise<void>; syncCanvas?: () => Promise<void> }
export type MediaAssistantNode = { id: string; type: string; name: string; text: string; assetId: string | null; durationSeconds?: number; model?: string; mode?: string }
type MediaCanvasOperation =
  | { action: 'add_image_generation'; name: string; text: string }
  | { action: 'add_video'; name: string; text: string; duration_seconds: number; model?: string; generation?: GenerationSettings; connect_from_id?: string; connect_from_ids?: string[] }
  | { action: 'connect_nodes'; source_id: string; target_id: string }
  | { action: 'add_image'; name: string; text: string }
  | { action: 'add_audio'; name: string; text: string }
  | { action: 'add_note'; text: string }
  | { action: 'update_node'; node_id: string; name?: string; text?: string; duration_seconds?: number; model?: string; generation?: Partial<GenerationSettings>; expected_generation?: Record<string, string> }
export type MediaCanvasPlan = { title: string; operations: MediaCanvasOperation[]; project_id?: string; version?: number }

const promptsByPage: Record<MediaAssistantPage, string[]> = {
  projects: ['把一句想法拆成短片方案', '给我一个可拍的 6 镜头结构'],
  project: ['为这部作品规划镜头节奏', '列出还需要补齐的素材'],
  canvas: ['把当前想法拆成分镜并添加到画布', '检查镜头节奏与转场'],
  assets: ['给素材库一套命名与分组规则', '根据现有素材列拍摄补充清单'],
}
const pageLabels: Record<MediaAssistantPage, string> = { projects: '作品列表', project: '作品概览', canvas: '创作画布', assets: '素材库' }
const nodeTypeLabels: Record<string, string> = { video: '生视频节点', image_generation: '生图节点', audio_generation: '生音频节点', video_asset: '视频节点', image: '图片节点', audio: '音频节点', note: '便签', text: '文本', shape: '形状', asset: '素材', group: '分组' }

function nodeLabel(node: MediaAssistantNode) { return node.name.trim() || node.text.trim().slice(0, 24) || nodeTypeLabels[node.type] || '节点' }
export function MediaAssistant({ userId, attachmentsAllowed, page, projectId, selectedNode, canvasActions }: {
  userId: string
  attachmentsAllowed: boolean
  page: MediaAssistantPage
  projectId?: string
  selectedNode: MediaAssistantNode | null
  onApplyCanvasPlan?: (plan: MediaCanvasPlan) => void
  canvasActions?: MediaCanvasActions | null
}) {
  const [canvasResources, setCanvasResources] = useState<Record<string, MediaGenerationResource>>({})
  const attachedResources = useRef(new Set<string>())
  const [syncError, setSyncError] = useState('')
  const [syncAttempt, setSyncAttempt] = useState(0)
  useEffect(() => {
    if (!canvasActions || canvasActions.readOnly || !projectId) return
    let active = true

    const attach = async () => {
      let retry = false
      for (const resource of Object.values(canvasResources)) {
        if (!active || resource.scope_id !== projectId || attachedResources.current.has(resource.id)) continue
        try {
          if (resource.kind === 'canvas_edit') {
            if (!canvasActions.syncCanvas) throw new Error('画布尚未就绪')
            await canvasActions.syncCanvas()
          } else if (resource.kind === 'canvas_node_rename') {
            if (!canvasActions.syncNodeNames) throw new Error('画布尚未就绪')
            await canvasActions.syncNodeNames()
          } else await canvasActions.attachImageTask(resource)
          if (active) attachedResources.current.add(resource.id)
        } catch { retry = true }
      }
      if (active) setSyncError(retry ? '操作已执行，但画布同步失败。重试同步不会重新生成或再次修改。' : '')
    }
    void attach()
    return () => { active = false }
  }, [canvasActions, canvasResources, projectId, syncAttempt])
  const [dismissedNodeId, setDismissedNodeId] = useState<string | null>(null)
  const discussionNode = selectedNode?.id === dismissedNodeId ? null : selectedNode
  const collectResources = (resources: MediaGenerationResource[]) => {
    setCanvasResources(current => resources.every(resource => current[resource.id]) ? current : { ...current, ...Object.fromEntries(resources.map(resource => [resource.id, resource])) })
  }
  return <AgentAssistant userId={userId} page={{ route: window.location.pathname, section: 'media', pageType: 'section' }} editor={null} media={{
    name: '镜头搭档',
    readOnly: canvasActions?.readOnly,
    status: syncError ? <p className="studio-assistant__request-error" role="alert">{syncError}<button type="button" onClick={() => setSyncAttempt(value => value + 1)}>重试同步</button></p> : canvasActions?.readOnly ? <p className="studio-assistant__message-status">只读画布 · 可以讨论，不能修改或生成</p> : null,
    onResources: collectResources,
    subtitle: '构思 · 分镜 · 编排',
    authKey: accountAuthTokenKey,
    attachmentsAllowed,
    className: page === 'canvas' ? 'media-assistant--canvas' : '',
    beforeSubmit: page === 'canvas' ? async () => {
      if (!canvasActions) throw new Error('画布尚未就绪，请稍后再试。')
      await canvasActions.save()
    } : undefined,
    onToolCalls: calls => {
      collectResources(calls.flatMap(call => call.status === 'succeeded' && call.resource?.module === 'media' && call.resource.parent_id ? [call.resource] : []))
    },
    contextLabel: discussionNode ? <><span>正在讨论 · {nodeLabel(discussionNode)}</span><button className="media-assistant__dismiss-node" type="button" aria-label="移除当前讨论节点" onClick={() => setDismissedNodeId(discussionNode.id)}><X aria-hidden="true" /></button></> : `当前页面：${pageLabels[page]}`,
    context: {
      module: 'media', route: window.location.pathname, page_type: page,
      selected_node: discussionNode ? { id: discussionNode.id, type: discussionNode.type, name: discussionNode.name, text: discussionNode.text, asset_id: discussionNode.assetId, duration_seconds: discussionNode.durationSeconds, model: discussionNode.model, mode: discussionNode.mode } : undefined,
      page: { project_id: projectId ?? null, area: pageLabels[page], read_only: canvasActions?.readOnly ?? null },
    },
    suggestions: promptsByPage[page],
    welcome: <><Clapperboard aria-hidden="true" /><span>镜头与叙事</span><h2>{selectedNode ? '接着这个镜头，往下想。' : page === 'assets' ? '整理素材，再开始拍。' : '下一段，怎么拍？'}</h2><p>{selectedNode ? '细化画面、调整节奏，或继续编排下一个镜头。' : page === 'canvas' ? '写下故事想法，或选中画布上的镜头一起讨论。' : page === 'assets' ? '讨论素材命名、分组与需要补充的画面。' : '从一句想法开始，一起规划故事、镜头与素材。'}</p></>,
    renderResponse: content => /```canvas-plan/i.test(content) ? <p className="studio-assistant__message-status">这是旧版画布方案。请让助手重新读取画布，准备可确认的操作。</p> : null,
  }} />
}
