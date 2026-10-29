import '../blog/agent/BlogAssistant.css'

import { type FormEvent, type ReactNode, memo, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Clock3, Gauge, Timer, Zap } from 'lucide-react'

import { StudioIcon } from '../../studio/StudioIcon'
import { TypewriterText } from '../../studio/TypewriterText'
import { motionTiming } from '../../lib/motion'
import { useChatAutoScroll } from './useChatAutoScroll'

function ProviderIcon({ provider }: { provider: AiProvider }) {
  const common = { viewBox: '0 0 24 24', role: 'img' as const, focusable: 'false' as const }

  if (provider === 'openai') {
    return <svg className={`provider-icon provider-icon--${provider}`} {...common} aria-label="OpenAI 官方标识"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" /></svg>
  }
  if (provider === 'mimo') {
    return <span className="provider-icon provider-icon--mimo" aria-label="小米 MiMo">Mi</span>
  }
  if (provider === 'grok') {
    return <svg className={`provider-icon provider-icon--${provider}`} {...common} aria-label="Grok / xAI 官方标识"><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" /></svg>
  }
  if (provider === 'gemini') {
    return <svg className={`provider-icon provider-icon--${provider}`} {...common} aria-label="Google Gemini 官方标识"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" /></svg>
  }
  return <svg className={`provider-icon provider-icon--${provider}`} {...common} aria-label="Claude / Anthropic 官方标识"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" /></svg>
}
import {
  ApiError,
  AiChatRunTerminalError,
  cancelAiChatRun,
  confirmAiAction,
  createAiChatRun,
  createAiConversation,
  getAiConversation,
  listAiConversations,
  deleteAiConversations,
  conversationIsSelected,
  renameAiConversation,
  getProviderModels,
  streamAiChatRun,
  type AiChatMessage,
  type AiChatContext,
  type AiActionProposal,
  type AiExecutionMode,
  type AiProvider,
  type AvailableModel,
  type AiConversation,
  type AiConversationSelection,
  type AiGenerationMetrics,
  type AiAttachment,
} from '../../lib/api'
import { AgentModelPicker } from './AgentModelPicker'
import { AgentToolHistory } from './AgentToolHistory'
import type { AiToolCall } from '../../lib/api'
import { BlogConversationHistory } from '../blog/agent/BlogConversationHistory'
import { BlogAgentAttachments, BlogMessageAttachments } from '../blog/agent/BlogAgentAttachments'
import { agentAttachmentAccept, useBlogAttachments } from '../blog/agent/useBlogAttachments'
import { BlogActionProposal } from '../blog/agent/BlogActionProposal'
import { AgentQuestion } from './AgentQuestion'
import { questionAnswers, splitAgentQuestion } from './questionProtocol'
import { modelDisplayName } from './modelDisplayName'
import { reasoningEffortLabel, thinkingModeLabel, useReasoningEffort } from './useReasoningEffort'
import { getStoredAuthToken, studioAuthTokenKey } from '../../lib/auth'
import { useBillingQuote } from '../billing/useBillingQuote'
import type { BillingOperation } from '../billing/api'
import type { AiChatRequest } from '../../lib/api'

type AssistantTiming = { startedAt: number; firstTokenAt?: number; completedAt?: number }
type AssistantMessage = { role: 'assistant' | 'user'; content: string; attachments?: AiAttachment[]; status?: string; error?: string | null; timing?: AssistantTiming; metrics?: AiGenerationMetrics | null; proposals?: AiActionProposal[]; executedProposals?: string[]; tool_calls?: AiToolCall[]; billing?: BillingOperation | null }
export type AssistantEditorContext = { id: string | null; title: string; excerpt: string; contentMarkdown: string; slug: string; status: 'draft' | 'published' }
export type AssistantPageContext = { route: string; section: string; pageType: 'overview' | 'posts_list' | 'post_editor' | 'post_preview' | 'section' }
type ActiveAssistantRun = { id: string; assistantMessageIndex: number }
type AssistantSession = { isOpen: boolean; messages: AssistantMessage[]; activeRun: ActiveAssistantRun | null; conversationId?: string | null }

const pageLabels: Record<AssistantPageContext['pageType'], string> = {
  overview: '内容总览',
  posts_list: '文章管理 / 文章列表',
  post_editor: '文章管理 / 文章编辑',
  post_preview: '文章管理 / 文章预览',
  section: '写作台功能页',
}

const defaultSuggestions = ['规划下一篇文章的主题与大纲', '梳理博客内容的分类与标签', '创建一篇新的文章草稿']
const assistantSessionKey = 'genesis-blog-ai-conversation'

function initialAssistantMessages(): AssistantMessage[] {
  return [{ role: 'assistant', content: '你好，我是博客助手。\n我会结合当前文章和页面帮你构思、改写与整理内容。' }]
}

function readAssistantSession(key = assistantSessionKey): AssistantSession {
  const fallback = { isOpen: false, messages: initialAssistantMessages(), activeRun: null }
  if (typeof window === 'undefined') return fallback

  try {
    const stored = JSON.parse(window.sessionStorage.getItem(key) ?? 'null') as unknown
    if (!stored || typeof stored !== 'object') return fallback
    const value = stored as { isOpen?: unknown; messages?: unknown; activeRun?: unknown; conversationId?: unknown }
    const messages = Array.isArray(value.messages)
      ? value.messages.filter((message): message is AssistantMessage => (
        typeof message === 'object'
        && message !== null
        && ((message as AssistantMessage).role === 'assistant' || (message as AssistantMessage).role === 'user')
        && typeof (message as AssistantMessage).content === 'string'
      ))
      : []
    const normalizedMessages = messages.length > 0 ? messages : initialAssistantMessages()
    const activeCandidate = value.activeRun
    const activeRun = (
      typeof activeCandidate === 'object'
      && activeCandidate !== null
      && typeof (activeCandidate as ActiveAssistantRun).id === 'string'
      && Number.isInteger((activeCandidate as ActiveAssistantRun).assistantMessageIndex)
      && normalizedMessages[(activeCandidate as ActiveAssistantRun).assistantMessageIndex]?.role === 'assistant'
    ) ? activeCandidate as ActiveAssistantRun : null
    const restoredMessages = activeRun
      ? normalizedMessages
      : normalizedMessages.filter((message) => message.content.trim().length > 0 || message.attachments?.length || message.proposals?.length || message.tool_calls?.length || message.status)
    return {
      isOpen: value.isOpen === true,
      messages: restoredMessages.length ? restoredMessages : initialAssistantMessages(),
      activeRun,
      conversationId: typeof value.conversationId === 'string' ? value.conversationId : null,
    }
  } catch {
    return fallback
  }
}

function parsePendingAction(content: string): AiActionProposal | null {
  const match = content.match(/\{[\s\S]*"type"\s*:\s*"pending_action"[\s\S]*\}/)
  if (!match) return null
  try {
    const value = JSON.parse(match[0]) as { type?: unknown; action?: unknown; payload?: unknown; proposal_token?: unknown }
    if (value.type !== 'pending_action' || typeof value.action !== 'string' || !value.payload || typeof value.payload !== 'object' || typeof value.proposal_token !== 'string') return null
    return value as unknown as AiActionProposal
  } catch { return null }
}

function readModelChoice(key: string): { provider: AiProvider; model: string } {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as { provider?: AiProvider; model?: string } | null
    if (value?.provider && ['openai', 'grok', 'gemini', 'claude', 'mimo'].includes(value.provider) && typeof value.model === 'string') return { provider: value.provider, model: value.model }
  } catch { /* 存储不可用时使用默认模型。 */ }
  return { provider: 'openai', model: '' }
}

function displaySeconds(seconds: number) {
  return Math.round(Math.max(0, seconds) * 100) / 100
}

function formatDuration(milliseconds: number) {
  const seconds = displaySeconds(milliseconds / 1000)
  if (seconds < 60) return `${seconds.toFixed(2)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${(seconds % 60).toFixed(2)}s`
}

const ResponseTiming = memo(function ResponseTiming({ timing, metrics, streaming, showMetrics, operationOnly = false }: { timing?: AssistantTiming; metrics?: AiGenerationMetrics | null; streaming: boolean; showMetrics: boolean; operationOnly?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!streaming || !timing) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [streaming, timing])
  if (!timing && !showMetrics) return null
  const end = timing?.completedAt ?? now
  const firstToken = timing?.firstTokenAt
  const source = metrics?.token_source ?? 'unavailable'
  const count = metrics?.output_tokens
  const seconds = metrics?.output_seconds == null ? null : displaySeconds(metrics.output_seconds)
  // 用界面同精度的输出时长计算，避免用户手算时与隐藏精度的结果不一致。
  const speed = metrics?.tokens_per_second != null && count != null && seconds !== null && seconds > 0 ? count / seconds : null
  const usageTitle = source === 'estimated' ? 'Token 数与速度为估算值' : 'Token 数来自供应商用量；速度按输出时长计算'
  const waiting = streaming && !firstToken && metrics?.first_token_seconds == null
  if (operationOnly && !streaming) {
    const total = metrics ? metrics.total_seconds * 1000 : timing ? end - timing.startedAt : null
    return total === null ? null : <div className="studio-assistant__timing" aria-label="操作耗时"><span><Clock3 aria-hidden="true" />处理耗时 <span className="studio-assistant__duration">{formatDuration(total)}</span></span></div>
  }
  if (waiting) return <div className="studio-assistant__timing" aria-label="生成耗时">
    <span><Timer aria-hidden="true" />等待首字 <span className="studio-assistant__duration">{formatDuration(timing ? end - timing.startedAt : (metrics?.total_seconds ?? 0) * 1000)}</span></span>
    {timing && end - timing.startedAt >= 15000 && <span className="studio-assistant__wait-hint">模型尚未返回正文，可继续等待，或停止后切换模型。</span>}
  </div>
  return <div className="studio-assistant__timing studio-assistant__timing--summary" role="group" tabIndex={0} aria-label="生成耗时" title="首字是开始执行到首次正文输出的等待时间；输出是首次到最后一次正文输出的时间，包含中途工具调用与模型等待；总计为首字与输出之和，不包含输出结束后的收尾处理。">
    {metrics && !streaming ? <>
      <span><Zap aria-hidden="true" />首字 <span className="studio-assistant__duration">{metrics.first_token_seconds === null ? '未输出' : formatDuration(metrics.first_token_seconds * 1000)}</span></span>
      <span><Timer aria-hidden="true" />输出 <span className="studio-assistant__duration">{metrics.output_seconds === null ? '—' : formatDuration(metrics.output_seconds * 1000)}</span></span>
      <span className="studio-assistant__timing-total"><Clock3 aria-hidden="true" />总计 <span className="studio-assistant__duration">{formatDuration(metrics.total_seconds * 1000)}</span></span>
    </> : timing && <>
      <span><Zap aria-hidden="true" />首字 <span className="studio-assistant__duration">{firstToken ? formatDuration(firstToken - timing.startedAt) : '未输出'}</span></span>
      <span><Timer aria-hidden="true" />输出 <span className="studio-assistant__duration">{firstToken ? formatDuration(end - firstToken) : '—'}</span></span>
      <span className="studio-assistant__timing-total"><Clock3 aria-hidden="true" />总计 <span className="studio-assistant__duration">{formatDuration(end - timing.startedAt)}</span></span>
    </>}
    {showMetrics && count != null && <span className="studio-assistant__speed" title={usageTitle}>
      <Gauge aria-hidden="true" />
      {`${count.toLocaleString('zh-CN')} tok`}
      {speed !== null && Number.isFinite(speed) ? ` · ${Number(speed.toFixed(1))} tok/s` : ''}
    </span>}
  </div>
})

const MarkdownMessage = memo(function MarkdownMessage({ content, status, error, timing, metrics, proposals, executedProposals, tool_calls, index, onConfirm, confirming, streaming, onProgress, onAnswer, questionDisabled, questionAnswer, targetPost, response }: AssistantMessage & { index: number; onConfirm: (index: number, action: AiActionProposal) => Promise<void>; confirming: boolean; streaming: boolean; onProgress: () => void; onAnswer: (answer: string) => void; questionDisabled: boolean; questionAnswer?: string; targetPost: AssistantEditorContext | null; response?: ReactNode }) {
  const legacyAction = streaming ? null : parsePendingAction(content)
  const actions = proposals?.length ? proposals : legacyAction ? [legacyAction] : []
  const operationOnly = (actions.length > 0 || Boolean(tool_calls?.length)) && !timing?.firstTokenAt && metrics?.first_token_seconds == null
  const question = splitAgentQuestion(content)
  return <div className="studio-assistant__response">
    <AgentToolHistory calls={tool_calls ?? []} proposals={actions} executedProposals={executedProposals} streaming={streaming} />
    {question.text && <div className="studio-assistant__markdown">{streaming ? <TypewriterText content={question.text} onProgress={onProgress} /> : <Markdown remarkPlugins={[remarkGfm]}>{question.text}</Markdown>}</div>}
    {!streaming && error && <p className="studio-assistant__message-status">{error.includes('停止') && !content.trim() ? '已停止，未收到模型正文。' : error}</p>}
    {!streaming && !error && status === 'completed' && !content.trim() && !actions.length && !tool_calls?.length && <p className="studio-assistant__message-status">本轮未返回正文，请重试或切换模型。</p>}
    {!streaming && !error && !content.trim() && actions.length > 0 && <p className="studio-assistant__stream-text">{actions.every(action => action.executed || executedProposals?.includes(action.proposal_id)) ? '操作已执行，结果如下。' : '操作提议已准备，请核对后确认。'}</p>}
    {question.request && <AgentQuestion key={question.request.id} request={question.request} disabled={questionDisabled} answered={questionAnswer !== undefined} answerContent={questionAnswer} onAnswer={onAnswer} />}
    {response}
    <ResponseTiming timing={timing} metrics={metrics} streaming={streaming} showMetrics={index > 0} operationOnly={operationOnly} />
    <ResponseTiming timing={timing} metrics={metrics} streaming={streaming} showMetrics={index > 0} operationOnly={operationOnly} />
    {actions.map((action) => <BlogActionProposal key={action.proposal_id} action={action} targetPost={targetPost} executed={Boolean(action.executed || executedProposals?.includes(action.proposal_id))} busy={confirming} disabled={streaming} onConfirm={() => { void onConfirm(index, action) }} />)}
  </div>
})

function updateAssistantMessage(
  messages: AssistantMessage[],
  index: number,
  update: (content: string) => string,
): AssistantMessage[] {
  if (messages[index]?.role !== 'assistant') return messages
  return messages.map((message, messageIndex) => (
    messageIndex === index ? { ...message, content: update(message.content) } : message
  ))
}

export type MediaAssistantVariant = {
  name: string
  subtitle: string
  context: AiChatContext
  suggestions: string[]
  welcome: ReactNode
  authKey: string
  attachmentsAllowed: boolean
  className: string
  contextLabel: ReactNode
  renderResponse: (content: string, key: string, disabled: boolean) => ReactNode
}

export function AgentAssistant({ page, editor, userId, onExecuted, media }: { page: AssistantPageContext; editor: AssistantEditorContext | null; userId?: string; onExecuted?: () => void; media?: MediaAssistantVariant }) {
  const surface = media ? 'media' : 'studio'
  const authKey = media?.authKey ?? studioAuthTokenKey
  const attachmentsAllowed = media?.attachmentsAllowed ?? true
  const name = media?.name ?? '博客助手'
  const isMedia = Boolean(media)
  const welcomeMessages = useCallback((): AssistantMessage[] => isMedia ? [{ role: 'assistant', content: '一起规划镜头、素材与创作。' }] : initialAssistantMessages(), [isMedia])
  useEffect(() => {
    if (!isMedia) return
    const show = () => setIsOpen(true)
    window.addEventListener('genesis:open-media-assistant', show)
    return () => window.removeEventListener('genesis:open-media-assistant', show)
  }, [isMedia])
  const reducedMotion = useReducedMotion()
  const transition = { duration: reducedMotion ? 0 : motionTiming.assistant, ease: motionTiming.assistantEase }
  const sessionKey = media ? 'genesis-media-ai-conversation' : assistantSessionKey
  const storageKey = userId ? `${sessionKey}:${userId}` : sessionKey
  const [initialSession] = useState(() => media ? { ...readAssistantSession(storageKey), messages: welcomeMessages() } : readAssistantSession(storageKey))
  const [initialModel] = useState(() => readModelChoice(`${storageKey}:model-choice`))
  const rootRef = useRef<HTMLDivElement | null>(null)
  const mediaWorkspaceRef = useRef<HTMLElement | null>(null)
  const studioShellRef = useRef<HTMLElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const launcherRef = useRef<HTMLButtonElement | null>(null)
  const [panelWidth, setPanelWidth] = useState(media ? 420 : 540)
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef<{ x: number; width: number } | null>(null)
  const drafts = useRef<Record<string, string>>({})
  const [isOpen, setIsOpen] = useState(initialSession.isOpen)
  const [conversation, setConversation] = useState<AiConversation | null>(null)
  const [conversationId, setConversationId] = useState(initialSession.conversationId ?? null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<AiConversation[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyDeleting, setHistoryDeleting] = useState(false)
  const historyDeletingRef = useRef(false)
  const historyRequestVersion = useRef(0)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [conversationLoading, setConversationLoading] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const selectionVersion = useRef(0)
  const hydrated = useRef<string | null>(null)
  const [messages, setMessages] = useState<AssistantMessage[]>(initialSession.messages)
  const [activeRun, setActiveRun] = useState<ActiveAssistantRun | null>(initialSession.activeRun)
  const [isStarting, setIsStarting] = useState(false)
  const [streamStatus, setStreamStatus] = useState<string | null>(initialSession.activeRun ? '正在恢复输出…' : null)
  const [draft, setDraft] = useState('')
  const attachments = useBlogAttachments(conversationId ?? 'new', authKey)
  const fileInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingAction, setConfirmingAction] = useState<number | null>(null)
  const [executionMode, setExecutionMode] = useState<AiExecutionMode>("approval_required")
  const [provider, setProvider] = useState<AiProvider>(initialModel.provider)
  const [model, setModel] = useState(initialModel.model)
  const [models, setModels] = useState<AvailableModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [modelsError, setModelsError] = useState('')
  const [modelsRevision, setModelsRevision] = useState(0)
  const { confirmQuote, quoteDialog } = useBillingQuote()
  const pendingRequest = useRef<AiChatRequest | null>(null)
  const modelsCache = useRef<Partial<Record<AiProvider, AvailableModel[]>>>({})
  const forceModelsRefresh = useRef(false)
  const modelsIdentity = useRef<string | null>(null)
  const selectedModels = useRef<Partial<Record<AiProvider, string>>>({ [initialModel.provider]: initialModel.model })
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const { bodyRef, contentRef, followOutput, scrollToLatest } = useChatAutoScroll(isOpen && (!historyOpen || expanded), conversationId)
  const streamControllerRef = useRef<AbortController | null>(null)
  const activeReceivedRef = useRef<{ index: number; content: string } | null>(null)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  useEffect(() => {
    if (isMedia && isOpen) inputRef.current?.focus()
  }, [isMedia, isOpen])
  useEffect(() => {
    if (!isMedia || !isOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || modelMenuOpen || renaming || document.querySelector('dialog[open]')) return
      if (historyOpen) setHistoryOpen(false)
      else if (expanded) setExpanded(false)
      else { setIsOpen(false); requestAnimationFrame(() => launcherRef.current?.focus()) }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [isMedia, isOpen, modelMenuOpen, renaming, historyOpen, expanded])
  const isBusy = isStarting || activeRun !== null || conversationLoading || historyDeleting
  const selectedModel = models.find((item) => item.id === model)
  const conversationAttachments = [...attachments.items, ...messages.flatMap(message => message.attachments ?? [])]
  const attachmentModelError = conversationAttachments.some(item => item.kind === 'image') && !selectedModel?.image_inputs
    ? '当前模型未标明支持图片，请切换支持识图的模型。'
    : conversationAttachments.some(item => item.kind === 'video') && !selectedModel?.video_inputs
      ? '当前模型或通道不支持视频，请切换 Gemini 原生通道。' : ''
  const attachmentBlocked = !!attachmentModelError || (attachments.items.length > 0 && !attachments.ready)
  const reasoning = useReasoningEffort(provider, model, selectedModel)
  const contextWindow = selectedModel?.context_window ?? null
  const latestMetrics = messages.filter(message => message.role === 'assistant').at(-1)?.metrics
  const contextTokens = latestMetrics?.input_provider === provider && latestMetrics.input_model === model
    && typeof latestMetrics.input_tokens === 'number' && Number.isSafeInteger(latestMetrics.input_tokens) && latestMetrics.input_tokens >= 0
    ? latestMetrics.input_tokens : null
  const formatTokens = (value: number | null) => {
    if (value === null) return '—'
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')}M`
    }
    if (value >= 1_000) return `${Math.round(value / 1_000)}K`
    return value.toLocaleString()
  }
  const contextPercent = contextTokens !== null && contextWindow && contextWindow > 0 ? Math.min(100, contextTokens / contextWindow * 100) : null
  const contextDescription = `${contextTokens === null ? '—' : contextTokens.toLocaleString('zh-CN')} / ${formatTokens(contextWindow)}`
  const suggestions = media?.suggestions ?? (editor ? ['分析当前文章结构和问题', '优化当前文章的表达和节奏', '为当前文章生成更好的标题'] : defaultSuggestions)

  useEffect(() => {
    if (!model) return
    try { sessionStorage.setItem(`${storageKey}:model-choice`, JSON.stringify({ provider, model })) } catch { /* 不影响当前请求。 */ }
  }, [storageKey, provider, model])

  useEffect(() => {
    const token = getStoredAuthToken(authKey)
    if (!token || !isOpen) return

    if (modelsIdentity.current !== token) {
      modelsIdentity.current = token
      modelsCache.current = {}
      setModels([])
    }
    let cancelled = false
    setModelsLoading(true)
    setModelsError('')
    const refresh = forceModelsRefresh.current
    forceModelsRefresh.current = false
    const load = async () => {
      let availableModels = modelsCache.current[provider] ?? []
      let loaded = false
      try {
        availableModels = (await getProviderModels(token, provider, { includePricing: false, refresh })).models
        if (cancelled) return
        modelsCache.current[provider] = availableModels
        loaded = true
      } catch (reason) {
        if (!cancelled) setModelsError(reason instanceof Error ? reason.message : '模型列表获取失败，请重新打开助手重试。')
      }
      if (cancelled) return
      setModelsLoading(false)
      setModels(availableModels)
      const preferredModel = selectedModels.current[provider]
      const nextModel = preferredModel && availableModels.some((item) => item.id === preferredModel)
        ? preferredModel : availableModels[0]?.id ?? ''
      selectedModels.current[provider] = nextModel
      setModel(nextModel)
      if (!loaded) return
      // 先展示可选模型，价格只更新附加信息，不重置用户刚选中的模型。
      try {
        const priced = (await getProviderModels(token, provider, { includePricing: true, reload: refresh })).models
        if (cancelled) return
        const prices = new Map(priced.map(item => [item.id, item.pricing]))
        const enriched = availableModels.map(item => ({ ...item, pricing: prices.get(item.id) ?? item.pricing }))
        modelsCache.current[provider] = enriched
        setModels(enriched)
      } catch { /* 价格失败不清空已加载目录，执行准入由服务端校验。 */ }
    }
    void load()
    return () => { cancelled = true }
  }, [isOpen, provider, authKey, modelsRevision])

  const sessionRef = useRef({ isOpen, messages, activeRun, conversationId })
  const saveTimer = useRef<number | null>(null)
  useEffect(() => {
    sessionRef.current = { isOpen, messages, activeRun, conversationId }
    const save = () => {
      saveTimer.current = null
      try { sessionStorage.setItem(storageKey, JSON.stringify(sessionRef.current.conversationId ? { isOpen: sessionRef.current.isOpen, conversationId: sessionRef.current.conversationId } : sessionRef.current)) } catch { /* 存储不可用时仍可继续对话。 */ }
    }
    if (!activeRun) {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      save()
    } else if (saveTimer.current === null) {
      saveTimer.current = window.setTimeout(save, 300)
    }
  }, [activeRun, isOpen, messages, conversationId, storageKey])

  useEffect(() => { drafts.current[conversationId ?? 'new'] = draft }, [draft, conversationId])

  useEffect(() => {
    const workspace = rootRef.current?.closest<HTMLElement>('.media-workspace') ?? mediaWorkspaceRef.current
    mediaWorkspaceRef.current = workspace ?? null
    workspace?.style.setProperty('--media-assistant-width', `${panelWidth}px`)
    if (workspace) {
      const controls = animate(workspace, { '--media-assistant-track': isOpen ? `${panelWidth + 32}px` : '0px' }, {
        duration: reducedMotion || resizing ? 0 : motionTiming.assistant,
        ease: motionTiming.assistantEase,
      })
      return () => { controls.stop() }
    }
    const shell = rootRef.current?.closest<HTMLElement>('.studio-app-shell') ?? studioShellRef.current
    studioShellRef.current = shell ?? null
    shell?.style.setProperty('--studio-assistant-width', `${panelWidth}px`)
    if (!shell) return
    // 连续调整工作区分栏，避免面板淡出后正文突然跳宽；拖动仍即时跟手。
    const controls = animate(shell, { '--studio-assistant-track': isOpen ? `${panelWidth}px` : '0px' }, {
      duration: reducedMotion || resizeStart.current ? 0 : motionTiming.assistant,
      ease: motionTiming.assistantEase,
    })
    return () => { controls.stop() }
  }, [isOpen, panelWidth, reducedMotion, resizing])

  const loadConversation = useCallback(async (id: string) => {
    if (historyDeletingRef.current) return
    const token = getStoredAuthToken(authKey)
    if (!token) return
    const version = ++selectionVersion.current
    setConversationLoading(true)
    setHistoryError(null)
    try {
      const result = await getAiConversation(token, id, surface)
      if (version !== selectionVersion.current) return
      streamControllerRef.current?.abort()
      hydrated.current = id
      setConversationId(id)
      setConversation(result)
      const restored: AssistantMessage[] = [
        ...welcomeMessages(),
        ...result.messages.map(({ role, content, metrics, proposals, status, error, attachments, tool_calls, billing }) => ({
          role, content, metrics, proposals, status, error, attachments, tool_calls, billing,
          ...((status === 'pending' || status === 'running') ? {
            timing: { startedAt: Date.now() - (metrics?.total_seconds ?? 0) * 1000 },
          } : {}),
        })),
      ]
      setMessages(restored)
      const runningIndex = result.messages.findIndex((message) => message.role === 'assistant' && (message.status === 'pending' || message.status === 'running'))
      const runningMessage = result.messages[runningIndex]
      setActiveRun(runningMessage ? { id: runningMessage.run_id, assistantMessageIndex: runningIndex + 1 } : null)
      setError(result.messages.at(-1)?.error ?? null)
      setHistoryOpen(false)
      setRenaming(false)
      setConfirmingAction(null)
      setModelMenuOpen(false)
      setDraft(drafts.current[id] ?? '')
      scrollToLatest()
    } catch (caught) {
      if (version === selectionVersion.current) {
        setHistoryError(caught instanceof Error ? caught.message : '读取对话失败，请重试。')
        setActiveRun((current) => current ? { ...current } : null)
      }
    } finally {
      if (version === selectionVersion.current) setConversationLoading(false)
    }
  }, [scrollToLatest, authKey, surface, welcomeMessages])

  useEffect(() => {
    if (isOpen && conversationId && hydrated.current !== conversationId) void loadConversation(conversationId)
  }, [isOpen, conversationId, loadConversation])

  const loadHistory = useCallback(async (offset = 0) => {
    const token = getStoredAuthToken(authKey)
    if (!token) return
    const version = ++historyRequestVersion.current
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const result = await listAiConversations(token, offset, surface)
      if (version !== historyRequestVersion.current) return
      setHistory((current) => offset ? [...current, ...result.filter((item) => !current.some((existing) => existing.id === item.id))] : result)
      setHasMoreHistory(result.length === 30)
    } catch (caught) {
      if (version === historyRequestVersion.current) setHistoryError(caught instanceof Error ? caught.message : '读取历史失败，请重试。')
    } finally { if (version === historyRequestVersion.current) setHistoryLoading(false) }
  }, [authKey, surface])

  async function deleteHistory(selection: AiConversationSelection): Promise<number> {
    const token = getStoredAuthToken(authKey)
    if (!token) throw new Error('登录已失效，请重新登录。')
    if (historyDeletingRef.current) throw new Error('正在删除对话，请稍候。')
    historyDeletingRef.current = true
    setHistoryDeleting(true)
    ++historyRequestVersion.current
    setHistoryLoading(false)
    try {
      const result = await deleteAiConversations(token, selection, surface)
      attachments.drop(selection)
      setHistory(current => current.filter(item => !conversationIsSelected(selection, item.id)))
      for (const id of Object.keys(drafts.current)) {
        if (id !== 'new' && conversationIsSelected(selection, id)) delete drafts.current[id]
      }
      if (conversationId && conversationIsSelected(selection, conversationId)) resetConversation()
      // 删除已成功；刷新失败只提示读取错误，不能把成功删除误报为失败。
      await loadHistory()
      return result.deleted_count
    } finally { historyDeletingRef.current = false; setHistoryDeleting(false) }
  }

  useEffect(() => {
    let cancelled = false
    if (isOpen && (historyOpen || expanded)) void Promise.resolve().then(() => { if (!cancelled) void loadHistory() })
    return () => { cancelled = true }
  }, [historyOpen, expanded, isOpen, loadHistory])

  useEffect(() => {
    if (!isOpen || !conversationId || conversation?.title_source !== 'pending') return
    let cancelled = false
    const token = getStoredAuthToken(authKey)
    if (!token) return
    const timer = window.setInterval(() => {
      const version = selectionVersion.current
      void getAiConversation(token, conversationId, surface).then((result) => {
        if (!cancelled && !historyDeletingRef.current && version === selectionVersion.current) {
          setConversation(result)
          setHistory((current) => current.map((item) => item.id === result.id ? result : item))
        }
      }).catch(() => { /* 标题轮询失败不打断正文；重新打开时恢复。 */ })
    }, 2500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [isOpen, conversationId, conversation?.title_source, authKey, surface])

  async function saveTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = getStoredAuthToken(authKey)
    if (!conversationId || !token || renameBusy || historyDeletingRef.current) return
    if (!titleDraft.trim()) { setRenameError('请输入对话标题。'); return }
    setRenameBusy(true)
    setRenameError(null)
    const id = conversationId
    try {
      const saved = await renameAiConversation(token, id, titleDraft.trim(), surface)
      setConversation(saved)
      setHistory((current) => current.map((item) => item.id === id ? saved : item))
      setRenaming(false)
    } catch (caught) {
      setRenameError(caught instanceof Error ? caught.message : '重命名失败，请重试。')
    } finally { setRenameBusy(false) }
  }

  useEffect(() => {
    const flush = () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      saveTimer.current = null
      try { sessionStorage.setItem(storageKey, JSON.stringify(sessionRef.current.conversationId ? { isOpen: sessionRef.current.isOpen, conversationId: sessionRef.current.conversationId } : sessionRef.current)) } catch { /* 忽略存储配额错误。 */ }
    }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [storageKey])

  useEffect(() => {
    if (!modelMenuOpen || !isOpen) return
    const outside = (event: Event) => {
      const target = event.target
      if (target instanceof Node && !modelMenuRef.current?.contains(target) && !modelTriggerRef.current?.contains(target)) setModelMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setModelMenuOpen(false)
      modelTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [modelMenuOpen, isOpen])

  const notifyAutomaticExecution = useEffectEvent(() => onExecuted?.())
  useEffect(() => {
    if (!activeRun || !isOpen) return
    const run = activeRun
    const token = getStoredAuthToken(authKey)
    if (!token) return

    let cancelled = false
    const controller = new AbortController()
    const notifiedExecutions = new Set<string>()
    const selection = selectionVersion.current
    streamControllerRef.current = controller
    let received = sessionRef.current.messages[run.assistantMessageIndex]?.content ?? ''
    activeReceivedRef.current = { index: run.assistantMessageIndex, content: received }
    let firstTokenAt = sessionRef.current.messages[run.assistantMessageIndex]?.timing?.firstTokenAt
    let pendingFrame: number | null = null
    const flush = () => {
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
      pendingFrame = null
      if (selection !== selectionVersion.current) return
      setMessages((current) => updateAssistantMessage(current, run.assistantMessageIndex, () => received))
    }
    const queue = () => { if (pendingFrame === null) pendingFrame = requestAnimationFrame(flush) }
    const markFirstToken = (content: string) => {
      if (firstTokenAt || !content) return
      firstTokenAt = Date.now()
      setMessages((current) => current.map((message, index) => index === run.assistantMessageIndex
        ? { ...message, timing: { ...(message.timing ?? { startedAt: firstTokenAt! }), firstTokenAt } }
        : message))
    }

    async function consumeRun() {
      setError(null)
      setStreamStatus('正在恢复输出…')
      while (!cancelled) {
        try {
          const result = await streamAiChatRun(token!, run.id, {
            onToolCalls: (tool_calls) => {
              if (cancelled || selection !== selectionVersion.current) return
              setMessages(current => current.map((message, index) => index === run.assistantMessageIndex
                ? { ...message, tool_calls } : message))
            },
            onProposals: (proposals) => {
              if (cancelled || selection !== selectionVersion.current) return
              for (const proposal of proposals) {
                if (proposal.executed && !notifiedExecutions.has(proposal.proposal_id)) {
                  notifiedExecutions.add(proposal.proposal_id)
                  notifyAutomaticExecution()
                }
              }
              setMessages((current) => current.map((message, index) => index === run.assistantMessageIndex
                ? { ...message, proposals } : message))
            },
            onMetrics: (metrics) => {
              if (cancelled || selection !== selectionVersion.current) return
              setMessages((current) => current.map((message, index) => index === run.assistantMessageIndex
                ? { ...message, metrics } : message))
            },
            onBilling: (billing) => {
              if (cancelled || selection !== selectionVersion.current) return
              setMessages(current => current.map((message, index) => index === run.assistantMessageIndex ? { ...message, billing } : message))
            },
            onSnapshot: (content) => { received = content; activeReceivedRef.current = { index: run.assistantMessageIndex, content: received }; markFirstToken(content); queue(); setStreamStatus('正在生成…') },
          }, controller.signal)
          if (cancelled || selection !== selectionVersion.current) return
          if (result === 'completed') {
            flush()
            const completedAt = Date.now()
            setMessages((current) => current
              .map((message, index) => index === run.assistantMessageIndex
                ? { ...message, status: 'completed', timing: message.timing ? { ...message.timing, firstTokenAt, completedAt } : undefined }
                : message))
            setActiveRun((current) => current?.id === run.id ? null : current)
            setStreamStatus(null)
            setError(null)
            return
          }
          setStreamStatus('连接中断，正在恢复…')
        } catch (caught) {
          if (cancelled || (caught instanceof DOMException && caught.name === 'AbortError')) return
          if (caught instanceof AiChatRunTerminalError) {
            flush()
            setMessages((current) => current.map((message, index) => index === run.assistantMessageIndex ? {
              ...message, status: 'failed', error: caught.message,
              timing: message.timing ? { ...message.timing, firstTokenAt, completedAt: Date.now() } : undefined,
            } : message))
            setError(null)
            setActiveRun((current) => current?.id === run.id ? null : current)
            setStreamStatus(null)
            return
          }
          setStreamStatus('连接中断，正在恢复…')
        }
        await new Promise((resolve) => window.setTimeout(resolve, 800))
      }
    }

    void consumeRun()
    return () => {
      cancelled = true
      controller.abort()
      if (streamControllerRef.current === controller) streamControllerRef.current = null
      if (activeReceivedRef.current?.index === run.assistantMessageIndex) activeReceivedRef.current = null
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
    }
  }, [activeRun, isOpen, authKey])

  function startNewConversation() {
    if (isStarting || conversationLoading || renameBusy || historyDeletingRef.current) return
    resetConversation()
    setHistoryOpen(false)
  }

  function resetConversation() {
    pendingRequest.current = null
    ++selectionVersion.current
    streamControllerRef.current?.abort()
    setActiveRun(null)
    setConversationId(null)
    setConversation(null)
    setConfirmingAction(null)
    hydrated.current = null
    setConversationLoading(false)
    setHistoryError(null)
    setRenaming(false)
    setMessages(welcomeMessages())
    setDraft('')
    setError(null)
    setStreamStatus(null)
    setModelMenuOpen(false)
    sessionRef.current = { isOpen, messages: welcomeMessages(), activeRun: null, conversationId: null }
    try { sessionStorage.removeItem(storageKey) } catch { /* 存储不可用时仍清理内存中的已删除对话。 */ }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await sendMessage(draft)
  }

  async function sendMessage(answer: string) {
    const content = answer.trim()
    const token = getStoredAuthToken(authKey)
    if ((!content && !attachments.items.length) || isBusy || attachmentBlocked || !token) return
    const selectedAttachments: AiAttachment[] = attachments.items.map(({ id, name, size, mime_type, kind }) => ({ id, name, size, mime_type, kind }))
    const nextMessages: AiChatMessage[] = [
      ...messages.filter((message) => message.content.trim().length > 0).map(({ role, content: messageContent }) => ({ role, content: messageContent })),
      { role: 'user', content },
    ]
    if (!conversationId && nextMessages.length > 40) {
      setError('当前对话已达到 40 条消息上限，请新建对话后继续。')
      return
    }
    const retainedMessages = messages.filter((message) => message.content.trim().length > 0 || message.attachments?.length || message.proposals?.length || message.status)
    let quoteId: string | undefined
    const previousRequest = pendingRequest.current
    if (previousRequest && (previousRequest.messages[0]?.content !== content || previousRequest.provider !== provider || previousRequest.model !== (model || undefined))) {
      setError('上次提交结果尚未确认，请先重新打开助手核对会话，再发起不同请求。')
      return
    }
    if (!previousRequest && selectedModel?.billing_mode) {
      try {
        const quote = await confirmQuote({ kind:'agent',provider,model }, token)
        if (!quote) return
        quoteId = quote.id
      } catch (reason) { setError((reason as Error).message); return }
    }
    const assistantMessageIndex = retainedMessages.length + 1
    scrollToLatest()
    setMessages([...retainedMessages, { role: 'user', content, attachments: selectedAttachments }, { role: 'assistant', content: '', timing: { startedAt: Date.now() } }])
    setDraft('')
    setError(null)
    setStreamStatus('正在创建生成任务…')
    setIsStarting(true)
    try {
      let id = conversationId
      if (!id) {
        const created = await createAiConversation(token, surface)
        id = created.id
        hydrated.current = id
        setConversation(created)
        setConversationId(id)
        attachments.moveTo(id)
      }
      const body: AiChatRequest = previousRequest ?? {
        request_id: crypto.randomUUID(),
        ...(quoteId ? { quote_id:quoteId } : {}),
        surface,
        conversation_id: id,
        messages: [{ role: 'user', content, ...(selectedAttachments.length ? { attachment_ids: selectedAttachments.map(item => item.id) } : {}) }],
        provider,
        model: model || undefined,
        reasoning_effort: reasoning.effort,
        thinking_mode: reasoning.thinkingMode,
        execution_mode: media ? 'approval_required' : executionMode,
        context: media?.context ?? {
          module: 'blog',
          route: page.route,
          section: page.section,
          page_type: page.pageType,
          ...(editor ? {
            post_id: editor.id ?? undefined,
            title: editor.title,
            excerpt: editor.excerpt,
            content_markdown: editor.contentMarkdown,
            editor_status: editor.status,
          } : {}),
        },
      }
      pendingRequest.current = body
      const run = await createAiChatRun(token, body)
      pendingRequest.current = null
      setActiveRun({ id: run.id, assistantMessageIndex })
      attachments.clear(id)
      setStreamStatus('正在生成…')
    } catch (caught) {
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500) pendingRequest.current = null
      setError(caught instanceof Error ? caught.message : 'AI 请求失败，请稍后再试。')
      setStreamStatus(null)
      setMessages((current) => current.slice(0, assistantMessageIndex - 1))
      setDraft(content)
    } finally {
      setIsStarting(false)
    }
  }

  function handleSuggestion(suggestion: string) {
    setDraft(suggestion)
  }

  function stopGeneration() {
    const run = activeRun
    if (!run) return
    const token = getStoredAuthToken(authKey)
    const completedAt = Date.now()
    const latest = activeReceivedRef.current
    streamControllerRef.current?.abort()
    setMessages((current) => current
      .map((message, index) => index === run.assistantMessageIndex
        ? {
            ...message,
            content: latest?.index === index ? latest.content : message.content,
            status: 'failed', error: '生成已由用户停止。',
            timing: message.timing ? { ...message.timing, completedAt } : undefined,
          }
        : message)
      .filter((message) => message.content.trim().length > 0 || message.attachments?.length || message.proposals?.length || message.status))
    setActiveRun(null)
    setStreamStatus(null)
    setError(null)
    if (token) void cancelAiChatRun(token, run.id).catch(() => {
      setError('输出已在当前页面停止，但服务端取消请求失败。')
    })
  }

  const handleConfirmAction = useCallback(async (messageIndex: number, action: AiActionProposal) => {
    const token = getStoredAuthToken(authKey)
    if (!token) return
    const selection = selectionVersion.current
    setConfirmingAction(messageIndex)
    setError(null)
    try {
      const result = await confirmAiAction(token, action.proposal_token)
      onExecuted?.()
      if (selection !== selectionVersion.current) return
      setMessages((current) => current.map((message, index) => index === messageIndex
        ? { ...message, proposals: message.proposals?.map(item => item.proposal_id === action.proposal_id ? { ...item, executed: true, execution_result: { ...result } } : item), executedProposals: [...(message.executedProposals ?? []), action.proposal_id], content: `${message.content}\n\n已确认并执行。` }
        : message))
    } catch (caught) {
      if (selection !== selectionVersion.current) return
      setError(caught instanceof Error ? caught.message : '操作执行失败，请稍后重试。')
    } finally {
      if (selection === selectionVersion.current) setConfirmingAction(null)
    }
  }, [onExecuted, authKey])

  return (
    <>{quoteDialog}<AnimatePresence initial={false}>
    {isOpen ? <motion.div key="assistant" ref={rootRef} className={`studio-assistant${media ? ` media-assistant ${media.className}` : ''} is-open${expanded ? ' is-expanded' : ''}`}
      initial={{ opacity: 0, x: reducedMotion ? 0 : media ? 24 : '100%', y: reducedMotion || !media ? 0 : 16, '--assistant-motion-width': `${panelWidth}px` }} animate={{ opacity: 1, x: 0, y: 0, '--assistant-motion-width': expanded ? '960px' : `${panelWidth}px` }} exit={{ opacity: 0, x: reducedMotion ? 0 : media ? 24 : '100%', y: reducedMotion || !media ? 0 : 16 }}
      transition={resizing ? { ...transition, duration: 0 } : transition}>
      {isOpen && !expanded && <div tabIndex={0} role="separator" aria-label="调整助手宽度" aria-orientation="vertical" aria-valuemin={340} aria-valuemax={600} aria-valuenow={panelWidth} className="studio-assistant__resize" title="拖动或用左右方向键调整宽度" onPointerDown={(event) => { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); setResizing(true); resizeStart.current = { x: event.clientX, width: panelWidth }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => { const start = resizeStart.current; if (start) setPanelWidth(Math.max(340, Math.min(600, start.width + start.x - event.clientX))) }} onPointerUp={() => { setResizing(false); resizeStart.current = null }} onPointerCancel={() => { setResizing(false); resizeStart.current = null }} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setPanelWidth((width) => Math.max(340, Math.min(600, width + (event.key === 'ArrowLeft' ? 16 : -16)))) } }} />}
        <section className={`studio-assistant__panel${messages.length === 1 && !isBusy ? ' is-empty' : ''}`} aria-label={media ? `${name} AI 助手` : '博客 AI 助手'}>
          <header className="studio-assistant__header">
            <div className="studio-assistant__identity">
              <span className="studio-assistant__avatar"><StudioIcon name="assistant" /></span>
              <div><strong>{name}</strong><span>{media?.subtitle ?? '构思 · 写作 · 整理'}</span></div>
            </div>
            <div className="studio-assistant__header-actions">
              <button type="button" aria-label="聊天历史" title="聊天历史" aria-expanded={historyOpen || expanded} onClick={() => { setHistoryOpen((open) => !open); setModelMenuOpen(false) }}><StudioIcon name="menu" /></button>
              <button className="studio-assistant__new-conversation" type="button" aria-label="新建对话" title="新建对话" disabled={isStarting || conversationLoading || renameBusy || historyDeleting} onClick={startNewConversation}>
                <StudioIcon name="plus" />
              </button>
              <button type="button" aria-label={expanded ? '还原助手宽度' : '展开助手'} title={expanded ? '还原助手宽度' : '展开助手'} onClick={() => { setExpanded((value) => !value); setHistoryOpen(false) }}><StudioIcon name={expanded ? 'arrow-right' : 'arrow-up-right'} /></button>
              <button className="studio-assistant__close" type="button" aria-label={media ? '关闭镜头搭档' : '关闭 AI 助手'} onClick={() => setIsOpen(false)}>
                <StudioIcon name="close" />
              </button>
            </div>
          </header>
          <div className={`studio-assistant__workspace${historyOpen ? ' is-history' : ''}`}>
          <AnimatePresence initial={false}>
          {(historyOpen || expanded) && <motion.nav key="history" className="studio-assistant__history" aria-label="历史对话" initial={{ opacity: 0, x: reducedMotion ? 0 : 8, ...(media && expanded ? { width: 0 } : {}) }} animate={{ opacity: 1, x: 0, ...(media && expanded ? { width: 224 } : {}) }} exit={{ opacity: 0, ...(media && expanded ? { width: 0 } : {}) }} transition={transition}>
            <BlogConversationHistory surface={surface} history={history} currentId={conversationId} loading={historyLoading} error={historyError} hasMore={hasMoreHistory} disabled={isStarting || conversationLoading || renameBusy || historyDeleting} expanded={expanded} onReload={() => { void loadHistory() }} onLoadMore={() => { void loadHistory(history.length) }} onOpen={id => { void loadConversation(id) }} onBack={() => setHistoryOpen(false)} onDelete={deleteHistory} />
          </motion.nav>}
          </AnimatePresence>
          <motion.div className="studio-assistant__chat" animate={{ opacity: historyOpen && !expanded ? 0 : 1 }} transition={transition}>
          <div className="studio-assistant__conversation-heading">
            {renaming ? <form noValidate onSubmit={(event) => { void saveTitle(event) }}>
              <input autoFocus aria-label="对话标题" maxLength={80} value={titleDraft} disabled={renameBusy} onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && !renameBusy) setRenaming(false) }} />
              <button type="submit" disabled={renameBusy}>{renameBusy ? '保存中…' : '保存'}</button><button type="button" disabled={renameBusy} onClick={() => setRenaming(false)}>取消</button>
              {renameError && <p role="alert">{renameError}</p>}
            </form> : <><strong title={conversation?.title}>{conversation?.title ?? '新对话'}</strong><button type="button" disabled={!conversationId || conversationLoading || historyDeleting} onClick={() => { setTitleDraft(conversation?.title ?? '新对话'); setRenameError(null); setRenaming(true) }}>重命名</button></>}
          </div>
          {conversationLoading && <p className="studio-assistant__loading" role="status">正在读取对话…</p>}
          {historyError && !historyOpen && <p className="studio-assistant__request-error" role="alert">{historyError}<button type="button" onClick={() => { if (conversationId) void loadConversation(conversationId) }}>重试</button></p>}
          <div
            className="studio-assistant__body"
            ref={bodyRef}
            tabIndex={0}
            role="region"
            aria-label="对话消息"
          >
            <div className="studio-assistant__scroll-content" ref={contentRef}>
            <div className="studio-assistant__context"><StudioIcon name="spark" /> {media?.contextLabel ?? (editor ? `当前文章：${editor.title || '未命名草稿'}` : `当前页面：${pageLabels[page.pageType]}`)}</div>
            <div className="studio-assistant__messages">
              {messages.map((message, index) => {
                if (media && index === 0) return messages.length === 1 ? <div key="welcome" className="media-assistant__welcome">{media.welcome}</div> : null
                const previous = messages[index - 1]
                const previousQuestion = previous?.role === 'assistant' ? splitAgentQuestion(previous.content).request : null
                // 卡片回答已汇入问题摘要，避免再用用户气泡重复整组问答。
                if (message.role === 'user' && previousQuestion && questionAnswers(previousQuestion, message.content)) return null
                return (
                <div className={`studio-assistant__message studio-assistant__message--${message.role}`} key={(message.role === 'assistant' ? splitAgentQuestion(message.content).request?.id : null) ?? `${conversationId ?? 'new'}-${message.role}-${index}`}>
                  {message.role === 'assistant' ? <MarkdownMessage {...message} {...(media ? { content: message.content.replace(/```canvas-plan[\s\S]*?(?:```|$)/ig, '').trim() } : {})} targetPost={editor} index={index} onConfirm={handleConfirmAction} confirming={confirmingAction === index} streaming={activeRun?.assistantMessageIndex === index || (isStarting && index === messages.length - 1)} onProgress={followOutput} onAnswer={(answer) => { void sendMessage(answer) }} questionDisabled={isBusy || conversationLoading} questionAnswer={messages.slice(index + 1).find((item) => item.role === 'user')?.content} response={media?.renderResponse(message.content, `${conversationId ?? 'new'}:${index}`, isBusy)} /> : <div className="blog-agent-user-content">{message.content && <p>{message.content}</p>}{!!message.attachments?.length && <BlogMessageAttachments items={message.attachments} authKey={authKey} />}</div>}
                </div>
              )})}
            </div>
            <p className={streamStatus?.startsWith('连接中断') ? 'studio-assistant__message-status' : 'sr-only'} role="status">{!error && (isBusy || streamStatus) ? (streamStatus ?? '正在生成…') : ''}</p>
            {messages.length === 1 && (
              <div className="studio-assistant__suggestions">
                <span>你可以这样开始</span>
                {suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => handleSuggestion(suggestion)}>{suggestion}<StudioIcon name="arrow-up-right" /></button>)}
              </div>
            )}
            </div>
          </div>
          <form className={`studio-assistant__composer${draggingFiles ? ' is-dragging' : ''}`} noValidate onSubmit={(event) => { void submit(event) }}
            onDragEnter={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current += 1; if (!isBusy) setDraggingFiles(true) }}
            onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
            onDragLeave={() => { dragDepth.current -= 1; if (dragDepth.current <= 0) setDraggingFiles(false) }}
            onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDraggingFiles(false); if (!isBusy && attachmentsAllowed) attachments.add(Array.from(event.dataTransfer.files)) }}>
            {!!attachments.items.length && <BlogAgentAttachments items={attachments.items} disabled={isBusy} onRetry={attachments.retry} onRemove={attachments.remove} onStop={attachments.stop} />}
            {(!media || draggingFiles) && <p className="blog-agent-upload-hint">{draggingFiles ? '松开以添加附件' : '文档、图片、视频 · 最多 8 个，共 20 MiB · 上传后保留在私有附件库'}</p>}
            {(attachments.error || attachmentModelError) && <p className="blog-agent-upload-error" role="alert">{attachments.error || attachmentModelError}</p>}
            <textarea className="resize-none"
              ref={inputRef}
              aria-label={`向${name}提问`}
              placeholder={media ? undefined : '告诉我你想完成什么…'}
              rows={2}
              value={draft}
              disabled={conversationLoading}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={event => {
                const files = Array.from(event.clipboardData.files)
                if (files.length && !isBusy && attachmentsAllowed) { event.preventDefault(); attachments.add(files) }
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }}
            />
            {error && <p className="studio-assistant__request-error" role="alert">{error}</p>}
            <div className="studio-assistant__composer-tools">
              <button type="button" className="studio-assistant__tool-button" aria-label="添加附件" title={attachmentsAllowed ? '添加文件、图片或视频' : '附件输入仅限站点所有者使用'} disabled={!attachmentsAllowed || isBusy || attachments.items.length >= 8} onClick={() => fileInput.current?.click()}><StudioIcon name="attachment" /></button>
              <input ref={fileInput} type="file" hidden multiple accept={agentAttachmentAccept} aria-label="选择 Agent 附件" onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (!isBusy && attachmentsAllowed) attachments.add(files) }} />
              {!media && <div className="studio-assistant__mode-switch">
                <select
                  aria-label="Agent 执行方式"
                  value={executionMode}
                  title={executionMode === 'approval_required' ? '执行操作前先请求你的确认' : '允许助手自动执行已请求的操作'}
                  onChange={(event) => setExecutionMode(event.target.value === 'automatic' ? 'automatic' : 'approval_required')}
                >
                  <option value="approval_required">审阅</option>
                  <option value="automatic">自动</option>
                </select>
              </div>}
              <button ref={modelTriggerRef} aria-label="选择模型" title={model || '选择模型'} className="studio-assistant__tool-button" type="button" onClick={() => setModelMenuOpen((open) => !open)} aria-expanded={modelMenuOpen}>
                {provider !== 'mimo' && <ProviderIcon provider={provider} />}<span className="studio-assistant__selected-model">{modelDisplayName(selectedModel?.name || model || '选择模型')}</span><span className="studio-assistant__selected-reasoning">{thinkingModeLabel(reasoning.thinkingMode) ?? reasoningEffortLabel(reasoning.effort)}</span><StudioIcon name="chevron" />
              </button>
              <span className="studio-assistant__context-ring" tabIndex={0} role={contextPercent === null ? 'img' : 'progressbar'} aria-label={`上下文用量${contextTokens === null ? '未知' : ''} ${contextDescription}`} aria-valuemin={contextPercent === null ? undefined : 0} aria-valuemax={contextPercent === null ? undefined : 100} aria-valuenow={contextPercent ?? undefined}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="studio-assistant__ring-track" cx="12" cy="12" r="9" />
                  {contextPercent !== null && <circle className="studio-assistant__ring-value" cx="12" cy="12" r="9" pathLength="100" strokeDasharray={`${contextPercent} 100`} transform="rotate(-90 12 12)" />}
                  {contextPercent === null && <text x="12" y="16" textAnchor="middle">?</text>}
                </svg>
                <span className="studio-assistant__ring-tooltip" aria-hidden="true">{contextDescription}</span>
              </span>
              {modelMenuOpen && <div ref={modelMenuRef} className="studio-assistant__model-menu">
                <AgentModelPicker provider={provider} models={models} model={model} loading={modelsLoading} error={modelsError} disabled={isBusy} effort={reasoning.effort} onRefresh={() => {
                  forceModelsRefresh.current = true
                  setModelsRevision(value => value + 1)
                }} onProviderChange={(next) => {
                  if (next === provider) return
                  setModelsLoading(true)
                  setProvider(next)
                  setModels(modelsCache.current[next] ?? [])
                  setModel(selectedModels.current[next] ?? modelsCache.current[next]?.[0]?.id ?? '')
                }} onModelChange={(next) => {
                  selectedModels.current[provider] = next
                  setModel(next)
                  setModelMenuOpen(false)
                  modelTriggerRef.current?.focus()
                }} onEffortChange={reasoning.setEffort} thinkingMode={reasoning.thinkingMode} onThinkingModeChange={reasoning.setThinkingMode} />
              </div>}
              {activeRun
                ? <button className="studio-assistant__stop" type="button" aria-label="停止生成" onClick={stopGeneration}><StudioIcon name="stop" /></button>
                : <button type="submit" aria-label={media ? '发送给镜头搭档' : '发送消息'} disabled={(!draft.trim() && !attachments.items.length) || isBusy || attachmentBlocked}><StudioIcon name="send" /></button>}
            </div>
          </form>
          </motion.div>
          </div>
        </section>
    </motion.div> : <motion.div key="launcher" className={`studio-assistant${media ? ` media-assistant ${media.className}` : ''} `} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition}>
      <button ref={launcherRef} className="studio-assistant__launcher" type="button" aria-expanded={isOpen} aria-label={media ? '镜头搭档' : '打开博客 AI 助手'} onClick={() => setIsOpen(true)}>
        <span className="studio-assistant__launcher-icon"><StudioIcon name={isOpen ? 'close' : 'assistant'} /></span>
        <span className="studio-assistant__launcher-copy"><strong>{isOpen ? '收起助手' : name}</strong><small>{isOpen ? '继续当前工作' : '当前模块的创作搭档'}</small></span>
        {!isOpen && <span className="studio-assistant__launcher-signal" />}
      </button>
    </motion.div>}
    </AnimatePresence></>
  )
}
