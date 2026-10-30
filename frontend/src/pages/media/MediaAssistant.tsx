import './CanvasAssistant.css'
import { Check, Clapperboard, WandSparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AiToolCall } from '../../lib/api'
import { AgentAssistant } from '../../features/agent/AgentAssistant'
import { accountAuthTokenKey } from '../../lib/auth'
import { api, defaultGenerationSettings, type Document, type GenerationSettings } from './api'
import type { VideoModel } from './VideoGeneration'
import { imageRatios, imageResolutions, imageSizePatch } from './imageSettings'

type MediaAssistantPage = 'projects' | 'project' | 'canvas' | 'assets'
export type MediaGenerationResource = NonNullable<AiToolCall['resource']>
export type MediaCanvasActions = { save: () => Promise<void>; getDocument: () => Document; attachImageTask: (resource: MediaGenerationResource) => Promise<void> }
export type MediaAssistantNode = { id: string; type: string; name: string; text: string; assetId: string | null; durationSeconds?: number; model?: string; mode?: string }
type MediaCanvasOperation =
  | { action: 'add_image_generation'; name: string; text: string }
  | { action: 'add_video'; name: string; text: string; duration_seconds: number; model?: string; generation?: GenerationSettings; connect_from_id?: string }
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
function canvasPlanFromMessage(content: string): MediaCanvasPlan | null {
  const match = content.match(/```canvas-plan\s*\n?([\s\S]*?)```/i)
  if (!match) return null
  try {
    const candidate = JSON.parse(match[1] ?? '') as { title?: unknown; operations?: unknown; project_id?: unknown; version?: unknown }
    if (!Array.isArray(candidate.operations) || candidate.operations.length === 0 || candidate.operations.length > 8) return null
    const operations: MediaCanvasOperation[] = []
    for (const item of candidate.operations) {
      if (!item || typeof item !== 'object') return null
      const operation = item as Record<string, unknown>
      const action = operation.action
      if (action === 'add_video' && typeof operation.name === 'string' && typeof operation.text === 'string') {
        if (typeof operation.duration_seconds !== 'number' || !Number.isInteger(operation.duration_seconds) || operation.duration_seconds < 1 || operation.duration_seconds > 60) return null
        if (operation.model !== undefined && (typeof operation.model !== 'string' || !operation.model.trim())) return null
        operations.push({ action, name: operation.name.slice(0, 120), text: operation.text.slice(0, 2000), duration_seconds: operation.duration_seconds, ...(typeof operation.model === 'string' ? { model: operation.model } : {}), ...(typeof operation.connect_from_id === 'string' ? { connect_from_id: operation.connect_from_id } : {}) })
      } else if ((action === 'add_image_generation' || action === 'add_image' || action === 'add_audio') && typeof operation.name === 'string' && typeof operation.text === 'string') {
        operations.push({ action, name: operation.name.slice(0, 120), text: operation.text.slice(0, 2000) })
      } else if (action === 'add_note' && typeof operation.text === 'string') {
        operations.push({ action, text: operation.text.slice(0, 2000) })
      } else if (action === 'update_node' && typeof operation.node_id === 'string') {
        if (operation.duration_seconds !== undefined && (typeof operation.duration_seconds !== 'number' || !Number.isInteger(operation.duration_seconds) || operation.duration_seconds < 1 || operation.duration_seconds > 60)) return null
        if (operation.model !== undefined && (typeof operation.model !== 'string' || !operation.model.trim())) return null
        const patch = { action, node_id: operation.node_id, ...(typeof operation.name === 'string' ? { name: operation.name.slice(0, 120) } : {}), ...(typeof operation.text === 'string' ? { text: operation.text.slice(0, 2000) } : {}), ...(typeof operation.duration_seconds === 'number' && Number.isFinite(operation.duration_seconds) ? { duration_seconds: Math.max(1, Math.min(60, Math.round(operation.duration_seconds))) } : {}) } as Extract<MediaCanvasOperation, { action: 'update_node' }>
        if (operation.generation !== undefined) {
          const generation = operation.generation as Record<string, unknown>
          if (!generation || typeof generation.model !== 'string' || !generation.model.trim() || !imageRatios.includes(generation.image_ratio as typeof imageRatios[number]) || !imageResolutions.includes(generation.image_resolution as typeof imageResolutions[number])) return null
          patch.generation = { model: generation.model, ...imageSizePatch(generation.image_ratio as typeof imageRatios[number], generation.image_resolution as typeof imageResolutions[number]) }
          const expected = operation.expected_generation
          if (!expected || typeof expected !== 'object' || Array.isArray(expected) || Object.values(expected).some(value => typeof value !== 'string')) return null
          patch.expected_generation = expected as Record<string, string>
        }
        if (typeof operation.model === 'string') patch.model = operation.model
        if (!('name' in patch) && !('text' in patch) && !('duration_seconds' in patch) && !patch.generation && !patch.model) return null
        operations.push(patch)
      } else return null
    }
    return { title: typeof candidate.title === 'string' ? candidate.title.slice(0, 80) : '镜头搭档方案', operations, ...(typeof candidate.project_id === 'string' ? { project_id: candidate.project_id } : {}), ...(typeof candidate.version === 'number' && Number.isInteger(candidate.version) ? { version: candidate.version } : {}) }
  } catch { return null }
}
function planSummary(plan: MediaCanvasPlan) {
  const imageGenerations = plan.operations.filter((item) => item.action === 'add_image_generation').length
  const videos = plan.operations.filter((item) => item.action === 'add_video').length
  const images = plan.operations.filter((item) => item.action === 'add_image').length
  const audios = plan.operations.filter((item) => item.action === 'add_audio').length
  const notes = plan.operations.filter((item) => item.action === 'add_note').length
  const updates = plan.operations.filter((item) => item.action === 'update_node').length
  const settings = [...new Set(plan.operations.flatMap(item => item.action === 'update_node' ? item.generation ? [`${item.generation.model} · ${item.generation.image_ratio} · ${item.generation.image_resolution}`] : item.model ? [item.model] : [] : []))]
  const seconds = plan.operations.reduce((total, item) => total + (item.action === 'add_video' ? item.duration_seconds : 0), 0)
  return [imageGenerations && `新增 ${imageGenerations} 个生图节点`, videos && `新增 ${videos} 个生视频节点`, videos && `生成素材共 ${seconds} 秒`, images && `新增 ${images} 个待选图片节点`, audios && `新增 ${audios} 个待导入音频节点`, notes && `新增 ${notes} 条便签`, updates && `更新 ${updates} 个节点`, ...settings].filter(Boolean).join(' · ')
}

export function MediaAssistant({ userId, attachmentsAllowed, page, projectId, selectedNode, onApplyCanvasPlan, canvasActions }: {
  userId: string
  attachmentsAllowed: boolean
  page: MediaAssistantPage
  projectId?: string
  selectedNode: MediaAssistantNode | null
  onApplyCanvasPlan?: (plan: MediaCanvasPlan) => void
  canvasActions?: MediaCanvasActions | null
}) {
  const [generationResources, setGenerationResources] = useState<Record<string, MediaGenerationResource>>({})
  const attachedGenerations = useRef(new Set<string>())
  useEffect(() => {
    if (!canvasActions || !projectId) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const attach = async () => {
      let retry = false
      for (const resource of Object.values(generationResources)) {
        if (!active || resource.scope_id !== projectId || attachedGenerations.current.has(resource.id)) continue
        try {
          await canvasActions.attachImageTask(resource)
          if (active) attachedGenerations.current.add(resource.id)
        } catch { retry = true }
      }
      if (active && retry) timer = setTimeout(() => { void attach() }, 3000)
    }
    void attach()
    return () => { active = false; clearTimeout(timer) }
  }, [canvasActions, generationResources, projectId])
  const [appliedPlans, setAppliedPlans] = useState<Set<string>>(() => new Set())
  const applying = useRef(false)
  const [pendingPlan, setPendingPlan] = useState<string | null>(null)
  const [planError, setPlanError] = useState<{ key: string; message: string } | null>(null)
  const [dismissedNodeId, setDismissedNodeId] = useState<string | null>(null)
  const discussionNode = selectedNode?.id === dismissedNodeId ? null : selectedNode
  async function applyPlan(plan: MediaCanvasPlan, key: string) {
    if (applying.current || !onApplyCanvasPlan) return
    applying.current = true
    setPendingPlan(key)
    setPlanError(null)
    try {
      let operations = plan.operations
      const imageUpdates = operations.filter(item => item.action === 'update_node' && item.generation)
      if (imageUpdates.length) {
        if (!projectId || plan.project_id !== projectId || plan.version === undefined) throw new Error('参数方案缺少当前作品或版本，请让助手重新读取画布。')
        const snapshot = await api<{ version: number }>(`/projects/${projectId}/canvas`)
        if (snapshot.version !== plan.version) throw new Error('画布已更新，请让助手重新读取画布后设置参数。')
        const catalog = await api<{ models: { id: string }[] }>('/image-models')
        for (const operation of imageUpdates) {
          if (operation.action === 'update_node' && !catalog.models.some(model => model.id === operation.generation?.model)) throw new Error('图片模型当前不可用，请重新查询模型目录。')
        }
      }
      const videos = plan.operations.filter(item => item.action === 'add_video')
      const updates = plan.operations.filter(item => item.action === 'update_node' && (item.duration_seconds !== undefined || item.model !== undefined))
      if (videos.length || updates.length) {
        const catalog = await api<{ models: VideoModel[] }>('/video-models')
        for (const operation of videos) {
          const model = catalog.models.find(item => item.id === operation.model)
          if (!model) {
            throw new Error(`「${operation.name}」的模型当前不可用，请让助手查询模型后重新规划。`)
          }
        }
        // 校验实际画布中的目标，选择状态仅用于讨论上下文。
        const document = canvasActions?.getDocument()
        for (const operation of updates) {
          if (operation.action !== 'update_node') continue
          const target = document?.nodes.find(node => node.id === operation.node_id)
          if (!target || target.type !== 'video') throw new Error('目标生视频节点已不存在，请让助手重新读取画布后规划。')
          // 校验本次应用后的模型，允许给尚未选模型的空白视频节点配置型号。
          const modelId = operation.model ?? target.generation?.model
          if (!modelId) throw new Error('方案未指定视频模型，请让助手查询模型目录并补充型号。')
          if (!catalog.models.some(item => item.id === modelId)) throw new Error(`视频模型「${modelId}」当前不可用，请让助手重新查询模型目录。`)
        }
        operations = operations.map(operation => {
          if (operation.action !== 'add_video') return operation
          const defaults = defaultGenerationSettings()
          return { ...operation, generation: {
            ...defaults, model: operation.model!,
          } }
        })
      }
      onApplyCanvasPlan({ ...plan, operations })
      setAppliedPlans(current => new Set(current).add(key))
    } catch (reason) {
      setPlanError({ key, message: reason instanceof Error ? reason.message : '方案校验失败，请重试。' })
    } finally {
      applying.current = false
      setPendingPlan(null)
    }
  }
  return <AgentAssistant userId={userId} page={{ route: window.location.pathname, section: 'media', pageType: 'section' }} editor={null} media={{
    name: '镜头搭档',
    subtitle: '构思 · 分镜 · 编排',
    authKey: accountAuthTokenKey,
    attachmentsAllowed,
    className: page === 'canvas' ? 'media-assistant--canvas' : '',
    beforeSubmit: page === 'canvas' ? async () => {
      if (!canvasActions) throw new Error('画布尚未就绪，请稍后再试。')
      await canvasActions.save()
    } : undefined,
    onToolCalls: calls => {
      const resources = calls.flatMap(call => call.status === 'succeeded' && call.name === 'submit_image_generation' && call.resource?.module === 'media' && call.resource.kind === 'image_generation' && call.resource.parent_id ? [call.resource] : [])
      if (resources.length) setGenerationResources(current => resources.every(resource => current[resource.id]) ? current : {...current,...Object.fromEntries(resources.map(resource=>[resource.id,resource]))})
    },
    contextLabel: discussionNode ? <><span>正在讨论 · {nodeLabel(discussionNode)}</span><button className="media-assistant__dismiss-node" type="button" aria-label="移除当前讨论节点" onClick={() => setDismissedNodeId(discussionNode.id)}><X aria-hidden="true" /></button></> : `当前页面：${pageLabels[page]}`,
    context: {
      module: 'media', route: window.location.pathname, page_type: page,
      selected_node: discussionNode ? { id: discussionNode.id, type: discussionNode.type, name: discussionNode.name, text: discussionNode.text, asset_id: discussionNode.assetId, duration_seconds: discussionNode.durationSeconds, model: discussionNode.model, mode: discussionNode.mode } : undefined,
      page: { project_id: projectId ?? null, area: pageLabels[page] },
    },
    suggestions: promptsByPage[page],
    welcome: <><Clapperboard aria-hidden="true" /><span>镜头与叙事</span><h2>{selectedNode ? '接着这个镜头，往下想。' : page === 'assets' ? '整理素材，再开始拍。' : '下一段，怎么拍？'}</h2><p>{selectedNode ? '细化画面、调整节奏，或继续编排下一个镜头。' : page === 'canvas' ? '写下故事想法，或选中画布上的镜头一起讨论。' : page === 'assets' ? '讨论素材命名、分组与需要补充的画面。' : '从一句想法开始，一起规划故事、镜头与素材。'}</p></>,
    renderResponse: (content, key, disabled) => {
      const plan = canvasPlanFromMessage(content)
      if (!plan || page !== 'canvas' || !onApplyCanvasPlan) return null
      const applied = appliedPlans.has(key)
      return <div className="media-assistant__plan"><strong><WandSparkles aria-hidden="true" />{plan.title}</strong><p>{planSummary(plan)}</p><p>仅添加或更新节点草案，不启动生成；连线用于参考，不会自动剪辑成片。</p>{planError?.key === key && <p role="alert">{planError.message}</p>}{applied ? <span className="media-assistant__plan-applied" role="status" aria-label="画布草案应用状态"><Check aria-hidden="true" />草案已应用</span> : <button type="button" disabled={disabled || pendingPlan !== null} onClick={() => { void applyPlan(plan, key) }}>{pendingPlan === key ? '校验中…' : '应用到画布'}</button>}</div>
    },
  }} />
}
