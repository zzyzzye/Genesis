import './CanvasAssistant.css'
import { Check, ChevronDown, Clapperboard, Plus, Send, WandSparkles, X } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { getProviderModels, streamAiChat, type AiChatMessage, type AiProvider, type AvailableModel } from '../../lib/api'
import { AgentModelPicker } from '../../features/agent/AgentModelPicker'
import { AgentQuestion } from '../../features/agent/AgentQuestion'
import { questionAnswers, splitAgentQuestion } from '../../features/agent/questionProtocol'
import { modelDisplayName } from '../../features/agent/modelDisplayName'
import { reasoningEffortLabel, thinkingModeLabel, useReasoningEffort } from '../../features/agent/useReasoningEffort'

type MediaAssistantPage = 'projects' | 'project' | 'canvas' | 'assets'
export type MediaAssistantNode = { id: string; type: string; name: string; text: string; assetId: string | null }
type MediaCanvasOperation =
  | { action: 'add_video'; name: string; text: string; duration_seconds: number; connect_from_id?: string }
  | { action: 'add_image'; name: string; text: string }
  | { action: 'add_audio'; name: string; text: string }
  | { action: 'add_note'; text: string }
  | { action: 'update_node'; node_id: string; name?: string; text?: string; duration_seconds?: number }
export type MediaCanvasPlan = { title: string; operations: MediaCanvasOperation[] }

const providerLabels: Record<AiProvider, string> = { openai: 'OpenAI', grok: 'Grok', gemini: 'Gemini', claude: 'Claude', mimo: 'MiMo' }
const promptsByPage: Record<MediaAssistantPage, string[]> = {
  projects: ['把一句想法拆成短片方案', '给我一个可拍的 6 镜头结构'],
  project: ['为这部作品规划镜头节奏', '列出还需要补齐的素材'],
  canvas: ['把当前想法拆成分镜并添加到画布', '检查镜头节奏与转场'],
  assets: ['给素材库一套命名与分组规则', '根据现有素材列拍摄补充清单'],
}
const pageLabels: Record<MediaAssistantPage, string> = { projects: '作品列表', project: '作品概览', canvas: '创作画布', assets: '素材库' }
const nodeTypeLabels: Record<string, string> = { video: '视频节点', image: '图片节点', audio: '音频节点', note: '便签', text: '文本', shape: '形状', asset: '素材', group: '分组' }

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

export function MediaAssistant({ token, page, projectId, selectedNode, onApplyCanvasPlan }: {
  token: string | null
  page: MediaAssistantPage
  projectId?: string
  selectedNode: MediaAssistantNode | null
  onApplyCanvasPlan?: (plan: MediaCanvasPlan) => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const openAssistant = () => setOpen(true)
    window.addEventListener('genesis:open-media-assistant', openAssistant)
    return () => window.removeEventListener('genesis:open-media-assistant', openAssistant)
  }, [])
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [provider, setProvider] = useState<AiProvider>('openai')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<AvailableModel[]>([])
  const selectedModel = models.find((item) => item.id === model)
  const reasoning = useReasoningEffort(provider, model, selectedModel)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [dismissedNodeId, setDismissedNodeId] = useState<string | null>(null)
  const [appliedPlans, setAppliedPlans] = useState<Set<number>>(() => new Set())
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const modelCache = useRef<Partial<Record<AiProvider, AvailableModel[]>>>({})
  const selectedModels = useRef<Partial<Record<AiProvider, string>>>({})
  const prompts = promptsByPage[page]
  const discussionNode = selectedNode?.id === dismissedNodeId ? null : selectedNode

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (modelMenuOpen) { setModelMenuOpen(false); modelTriggerRef.current?.focus(); return }
      setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [modelMenuOpen, open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!modelMenuOpen) return
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (modelMenuRef.current?.contains(target) || modelTriggerRef.current?.contains(target)) return
      setModelMenuOpen(false)
    }
    document.addEventListener('pointerdown', dismissOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', dismissOnOutsidePointer)
  }, [modelMenuOpen])

  useEffect(() => {
    if (!open || !token) return
    const authToken = token
    let active = true
    async function loadModels() {
      setModelsLoading(true)
      setModels([])
      setModel('')
      let available = modelCache.current[provider]
      if (!available) {
        try { available = (await getProviderModels(authToken, provider)).models } catch { available = [] }
        modelCache.current[provider] = available
      }
      if (!active) return
      setModels(available)
      setModelsLoading(false)
      const preferred = selectedModels.current[provider]
      const next = preferred && available.some((item) => item.id === preferred) ? preferred : available[0]?.id ?? ''
      selectedModels.current[provider] = next
      setModel(next)
    }
    void loadModels()
    return () => { active = false }
  }, [open, provider, token])

  async function send(content: string) {
    const text = content.trim()
    if (!text || busy) return
    if (!token) { setError('登录后才能使用镜头搭档。'); return }
    const nextMessages: AiChatMessage[] = [...messages, { role: 'user', content: text }]
    if (nextMessages.length > 40) { setError('当前对话已达到 40 条消息上限，请新建对话后继续。'); return }
    setMessages([...nextMessages, { role: 'assistant', content: '' }])
    setInput('')
    setError('')
    setBusy(true)
    try {
      await streamAiChat(token, {
        surface: 'media', messages: nextMessages, provider, model: model || undefined,
        reasoning_effort: reasoning.effort,
        thinking_mode: reasoning.thinkingMode,
        context: {
          module: 'media', route: window.location.pathname, page_type: page,
          selected_node: discussionNode ? { id: discussionNode.id, type: discussionNode.type, name: discussionNode.name, text: discussionNode.text, asset_id: discussionNode.assetId } : undefined,
          page: { project_id: projectId ?? null, area: pageLabels[page] },
        },
      }, (chunk) => setMessages((current) => {
        const last = current.at(-1)
        return !last || last.role !== 'assistant' ? current : [...current.slice(0, -1), { ...last, content: last.content + chunk }]
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '镜头搭档暂时无法回应，请稍后重试。')
      setMessages((current) => current.at(-1)?.role === 'assistant' && !current.at(-1)?.content ? current.slice(0, -2) : current)
      setInput(text)
    } finally { setBusy(false) }
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void send(input) }
  function selectModel(next: string) { selectedModels.current[provider] = next; setModel(next) }
  function startNewConversation() { if (!busy) { setMessages([]); setInput(''); setError(''); setAppliedPlans(new Set()) } }

  return <aside className={`media-agent media-agent--styled${page === 'canvas' ? ' media-agent--canvas' : ''}`} aria-label="影音创作助手">
    {open && <section className={`media-agent__panel${messages.length === 0 ? ' is-empty' : ''}`} role="dialog" aria-label="镜头搭档">
      <header className="media-agent__header">
        <div className="media-agent__identity"><span className="media-agent__avatar"><Clapperboard aria-hidden="true" /></span><div><strong>镜头搭档</strong><span>{pageLabels[page]}</span></div></div>
        <div className="media-agent__header-actions"><button type="button" aria-label="新建对话" disabled={busy} onClick={startNewConversation}><Plus aria-hidden="true" /></button><button type="button" className="media-agent__close" aria-label="关闭镜头搭档" onClick={() => setOpen(false)}><X aria-hidden="true" /></button></div>
      </header>
      <div className="media-agent__body">
        {discussionNode && <div className="media-agent__node-context"><div><span>正在讨论 · {nodeLabel(discussionNode)}</span>{page === 'canvas' && <small>{discussionNode.text.trim() || '还没有镜头描述，可以一起补充。'}</small>}</div><button type="button" aria-label="移除当前讨论节点" onClick={() => setDismissedNodeId(discussionNode.id)}><X aria-hidden="true" /></button></div>}
        <div className="media-agent__messages" aria-live="polite">
          {messages.length === 0 && <div className="media-agent__canvas-empty"><span>镜头与叙事</span><h2>{discussionNode ? '接着这个镜头，往下想。' : page === 'assets' ? '整理素材，再开始拍。' : '下一段，怎么拍？'}</h2><p>{discussionNode ? '细化画面、调整节奏，或继续编排下一个镜头。' : page === 'canvas' ? '写下故事想法，或选中画布上的镜头一起讨论。' : page === 'assets' ? '讨论素材命名、分组与需要补充的画面。' : '写下故事想法，一起规划镜头与素材。'}</p></div>}
          {messages.map((message, index) => {
            const previous = messages[index - 1]
            const previousQuestion = previous?.role === 'assistant' ? splitAgentQuestion(previous.content).request : null
            if (message.role === 'user' && previousQuestion && questionAnswers(previousQuestion, message.content)) return null
            const plan = message.role === 'assistant' ? canvasPlanFromMessage(message.content) : null
            const question = message.role === 'assistant' ? splitAgentQuestion(message.content) : { text: message.content, request: null }
            const visibleContent = message.role === 'assistant' ? question.text.replace(/```canvas-plan\s*\n?[\s\S]*?```/ig, '').trim() : message.content
            const applied = appliedPlans.has(index)
            const questionAnswer = messages.slice(index + 1).find((item) => item.role === 'user')?.content
            return <div className={`media-agent__message media-agent__message--${message.role}`} key={`${message.role}-${index}`}>{message.role === 'assistant' && <span className="media-agent__message-mark"><Clapperboard aria-hidden="true" /></span>}<div className="media-agent__response"><Markdown remarkPlugins={[remarkGfm]}>{visibleContent || (question.request ? '' : '正在整理镜头…')}</Markdown>{question.request && <AgentQuestion key={question.request.id} request={question.request} disabled={busy} answered={questionAnswer !== undefined} answerContent={questionAnswer} onAnswer={(answer) => { void send(answer) }} />}{plan && page === 'canvas' && onApplyCanvasPlan && <div className="media-agent__plan"><span><WandSparkles aria-hidden="true" />{planSummary(plan)}</span><button type="button" disabled={applied || busy} onClick={() => { onApplyCanvasPlan(plan); setAppliedPlans((current) => new Set(current).add(index)) }}>{applied ? <><Check aria-hidden="true" />已应用</> : '应用到画布'}</button></div>}</div></div>
          })}
        </div>
        {messages.length === 0 && <div className="media-agent__prompts" aria-label="快捷提问">{prompts.map((prompt, index) => <button type="button" key={prompt} onClick={() => void send(prompt)} disabled={busy}><span className="media-agent__prompt-icon">{index === 0 ? <Clapperboard /> : <WandSparkles />}</span><span className="media-agent__prompt-copy"><strong>{page === 'assets' ? (index === 0 ? '整理素材' : '补充画面') : page === 'project' ? (index === 0 ? '规划节奏' : '补齐素材') : index === 0 ? '拆成分镜' : '检查节奏'}</strong><small>{page === 'assets' ? (index === 0 ? '命名与分组' : '列出拍摄清单') : page === 'project' ? (index === 0 ? '安排镜头与叙事' : '列出素材清单') : index === 0 ? '整理镜头与画面' : '梳理转场与衔接'}</small></span><span>↗</span></button>)}</div>}
      </div>
      <form className="media-agent__form" noValidate onSubmit={submit}>
        <textarea className="resize-none" ref={inputRef} aria-label="向镜头搭档提问" aria-keyshortcuts="Enter" rows={2} value={input} onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return; event.preventDefault(); event.currentTarget.form?.requestSubmit() }} disabled={busy} placeholder="描述画面，或说说你想调整的地方…" />
        <div className="media-agent__composer-tools"><button ref={modelTriggerRef} className="media-agent__model-trigger" type="button" aria-label="选择模型" aria-expanded={modelMenuOpen} onClick={() => setModelMenuOpen((value) => !value)}><span>{providerLabels[provider]}</span><i aria-hidden="true">·</i><strong>{modelDisplayName(selectedModel?.name || model || '选择模型')}</strong><span>{thinkingModeLabel(reasoning.thinkingMode) ?? reasoningEffortLabel(reasoning.effort)}</span><ChevronDown aria-hidden="true" /></button>
          {modelMenuOpen && <div ref={modelMenuRef} className="media-agent__model-menu" aria-label="模型列表">
            <AgentModelPicker provider={provider} models={models} model={model} loading={modelsLoading} disabled={busy} effort={reasoning.effort} thinkingMode={reasoning.thinkingMode} onThinkingModeChange={reasoning.setThinkingMode} onProviderChange={setProvider} onModelChange={selectModel} onEffortChange={reasoning.setEffort} />
          </div>}
          <button className="media-agent__send" type="submit" aria-label="发送给镜头搭档" disabled={busy || !input.trim()}><Send aria-hidden="true" /></button>
        </div>{error && <p className="media-agent__error" role="alert">{error}</p>}
      </form>
    </section>}
    <button type="button" className="media-agent__launcher" aria-label={open ? '收起镜头搭档' : '镜头搭档'} aria-expanded={open} onClick={() => setOpen((value) => !value)}><span className="media-agent__launcher-icon"><Clapperboard aria-hidden="true" /></span><span className="media-agent__launcher-copy"><strong>{open ? '收起助手' : '镜头搭档'}</strong><small>{open ? '继续当前对话' : '当前画布的创作搭档'}</small></span></button>
  </aside>
}
