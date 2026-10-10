import './BlogAssistant.css'

import { type FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { StudioIcon } from '../../../studio/StudioIcon'
import { TypewriterText } from '../../../studio/TypewriterText'

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
  AiChatRunTerminalError,
  cancelAiChatRun,
  confirmAiAction,
  createAiChatRun,
  createAiConversation,
  getAiConversation,
  listAiConversations,
  renameAiConversation,
  getProviderModels,
  streamAiChatRun,
  type AiChatMessage,
  type AiActionProposal,
  type AiExecutionMode,
  type AiProvider,
  type AvailableModel,
  type AiConversation,
} from '../../../lib/api'
import { AgentModelPicker } from '../../agent/AgentModelPicker'
import { reasoningEffortLabel, thinkingModeLabel, useReasoningEffort } from '../../agent/useReasoningEffort'
import { getStoredAuthToken, studioAuthTokenKey } from '../../../lib/auth'

type AssistantTiming = { startedAt: number; firstTokenAt?: number; completedAt?: number }
type AssistantMessage = { role: 'assistant' | 'user'; content: string; timing?: AssistantTiming }
type AssistantEditorContext = { id: string | null; title: string; excerpt: string; contentMarkdown: string; slug: string; status: 'draft' | 'published' }
type AssistantPageContext = { route: string; section: string; pageType: 'overview' | 'posts_list' | 'post_editor' | 'post_preview' | 'section' }
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
      : normalizedMessages.filter((message) => message.content.trim().length > 0)
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

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, milliseconds) / 1000
  if (seconds < 10) return `${seconds.toFixed(1)} 秒`
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} 分 ${Math.round(seconds % 60)} 秒`
}

const ResponseTiming = memo(function ResponseTiming({ timing, streaming }: { timing?: AssistantTiming; streaming: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!streaming || !timing) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [streaming, timing])
  if (!timing) return null
  const end = timing.completedAt ?? now
  const firstToken = timing.firstTokenAt
  return <div className="studio-assistant__timing" aria-label="生成耗时">
    <span>思考 {formatDuration((firstToken ?? end) - timing.startedAt)}</span>
    <span>输出 {firstToken ? formatDuration(end - firstToken) : '等待中'}</span>
    <span>总计 {formatDuration(end - timing.startedAt)}</span>
  </div>
})

const MarkdownMessage = memo(function MarkdownMessage({ content, timing, index, onConfirm, confirming, streaming, onProgress }: { content: string; timing?: AssistantTiming; index: number; onConfirm: (index: number, action: AiActionProposal) => Promise<void>; confirming: boolean; streaming: boolean; onProgress: () => void }) {
  const action = streaming ? null : parsePendingAction(content)
  return <div className="studio-assistant__response">
    <div className="studio-assistant__markdown">{streaming ? <TypewriterText content={content} onProgress={onProgress} /> : <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>}</div>
    <ResponseTiming timing={timing} streaming={streaming} />
    {action && onConfirm && <div className="studio-assistant__action-card">
      <strong>待确认操作</strong><span>{action.action}</span>
      <button type="button" disabled={confirming} onClick={() => { void onConfirm(index, action) }}>{confirming ? '执行中…' : '确认执行'}</button>
    </div>}
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

export function BlogAssistant({ page, editor, userId }: { page: AssistantPageContext; editor: AssistantEditorContext | null; userId?: string }) {
  const storageKey = userId ? `${assistantSessionKey}:${userId}` : assistantSessionKey
  const [initialSession] = useState(() => readAssistantSession(storageKey))
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [panelWidth, setPanelWidth] = useState(420)
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
  const [error, setError] = useState<string | null>(null)
  const [confirmingAction, setConfirmingAction] = useState<number | null>(null)
  const [executionMode, setExecutionMode] = useState<AiExecutionMode>("approval_required")
  const [provider, setProvider] = useState<AiProvider>('openai')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<AvailableModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const modelsCache = useRef<Partial<Record<AiProvider, AvailableModel[]>>>({})
  const selectedModels = useRef<Partial<Record<AiProvider, string>>>({})
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const streamControllerRef = useRef<AbortController | null>(null)
  const activeReceivedRef = useRef<{ index: number; content: string } | null>(null)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const isBusy = isStarting || activeRun !== null || conversationLoading
  const selectedModel = models.find((item) => item.id === model)
  const reasoning = useReasoningEffort(provider, model, selectedModel)
  const contextWindow = selectedModel?.context_window ?? null
  const pageCharacters = useMemo(() => JSON.stringify({ page, editor }).length, [page, editor])
  const contextCharacters = pageCharacters + draft.length + messages.reduce((sum, message) => sum + message.content.length, 0)
  const contextTokens = Math.ceil(contextCharacters / 4)
  const formatTokens = (value: number | null) => {
    if (value === null) return '—'
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')}M`
    }
    if (value >= 1_000) return `${Math.round(value / 1_000)}K`
    return value.toLocaleString()
  }
  const contextPercent = contextWindow && contextWindow > 0 ? Math.min(100, contextTokens / contextWindow * 100) : null
  const contextDescription = contextPercent === null
    ? `上下文容量未知 · 估算 ${formatTokens(contextTokens)} token`
    : `上下文已用约 ${Math.round(contextPercent)}% · 估算 ${formatTokens(contextTokens)} / ${formatTokens(contextWindow)} token`
  const suggestions = editor ? ['分析当前文章结构和问题', '优化当前文章的表达和节奏', '为当前文章生成更好的标题'] : defaultSuggestions

  useEffect(() => {
    const token = getStoredAuthToken(studioAuthTokenKey)
    if (!token || !isOpen) return

    let cancelled = false
    const providers: AiProvider[] = ['openai', 'grok', 'gemini', 'claude', 'mimo']
    void Promise.all(providers.map(async (item) => {
      if (modelsCache.current[item]) return
      try {
        const result = await getProviderModels(token, item)
        modelsCache.current[item] = result.models
      } catch {
        modelsCache.current[item] = []
      }
    })).then(() => {
      if (cancelled) return
      setModelsLoading(false)
      const availableModels = modelsCache.current[provider] ?? []
      setModels(availableModels)
      const preferredModel = selectedModels.current[provider]
      const nextModel = preferredModel && availableModels.some((item) => item.id === preferredModel)
        ? preferredModel
        : availableModels[0]?.id ?? ''
      selectedModels.current[provider] = nextModel
      setModel(nextModel)
    })

    return () => { cancelled = true }
  }, [isOpen, provider])

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
    const shell = rootRef.current?.closest<HTMLElement>('.studio-app-shell')
    shell?.style.setProperty('--studio-assistant-width', `${panelWidth}px`)
    return () => { shell?.style.removeProperty('--studio-assistant-width') }
  }, [panelWidth])

  const loadConversation = useCallback(async (id: string) => {
    const token = getStoredAuthToken(studioAuthTokenKey)
    if (!token) return
    const version = ++selectionVersion.current
    setConversationLoading(true)
    setHistoryError(null)
    try {
      const result = await getAiConversation(token, id)
      if (version !== selectionVersion.current) return
      streamControllerRef.current?.abort()
      hydrated.current = id
      setConversationId(id)
      setConversation(result)
      const restored: AssistantMessage[] = [
        ...initialAssistantMessages(),
        ...result.messages.map(({ role, content }) => ({ role, content })),
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
      shouldStickToBottomRef.current = true
    } catch (caught) {
      if (version === selectionVersion.current) {
        setHistoryError(caught instanceof Error ? caught.message : '读取对话失败，请重试。')
        setActiveRun((current) => current ? { ...current } : null)
      }
    } finally {
      if (version === selectionVersion.current) setConversationLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen && conversationId && hydrated.current !== conversationId) void loadConversation(conversationId)
  }, [isOpen, conversationId, loadConversation])

  const loadHistory = useCallback(async (offset = 0) => {
    const token = getStoredAuthToken(studioAuthTokenKey)
    if (!token) return
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const result = await listAiConversations(token, offset)
      setHistory((current) => offset ? [...current, ...result.filter((item) => !current.some((existing) => existing.id === item.id))] : result)
      setHasMoreHistory(result.length === 30)
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : '读取历史失败，请重试。')
    } finally { setHistoryLoading(false) }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (isOpen && (historyOpen || expanded)) void Promise.resolve().then(() => { if (!cancelled) void loadHistory() })
    return () => { cancelled = true }
  }, [historyOpen, expanded, isOpen, loadHistory])

  useEffect(() => {
    if (!isOpen || !conversationId || conversation?.title_source !== 'pending') return
    let cancelled = false
    const token = getStoredAuthToken(studioAuthTokenKey)
    if (!token) return
    const timer = window.setInterval(() => {
      void getAiConversation(token, conversationId).then((result) => {
        if (!cancelled) {
          setConversation(result)
          setHistory((current) => current.map((item) => item.id === result.id ? result : item))
        }
      }).catch(() => { /* 标题轮询失败不打断正文；重新打开时恢复。 */ })
    }, 2500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [isOpen, conversationId, conversation?.title_source])

  async function saveTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = getStoredAuthToken(studioAuthTokenKey)
    if (!conversationId || !token || renameBusy) return
    if (!titleDraft.trim()) { setRenameError('请输入对话标题。'); return }
    setRenameBusy(true)
    setRenameError(null)
    const id = conversationId
    try {
      const saved = await renameAiConversation(token, id, titleDraft.trim())
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

  const followOutput = useCallback(() => {
    const body = bodyRef.current
    if (body && shouldStickToBottomRef.current) body.scrollTop = body.scrollHeight
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const frame = requestAnimationFrame(followOutput)
    return () => cancelAnimationFrame(frame)
  }, [isOpen, messages, followOutput])

  useEffect(() => {
    if (!activeRun || !isOpen) return
    const run = activeRun
    const token = getStoredAuthToken(studioAuthTokenKey)
    if (!token) return

    let cancelled = false
    const controller = new AbortController()
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
            onSnapshot: (content) => { received = content; activeReceivedRef.current = { index: run.assistantMessageIndex, content: received }; markFirstToken(content); queue(); setStreamStatus('正在生成…') },
            onToken: (content) => { received += content; activeReceivedRef.current = { index: run.assistantMessageIndex, content: received }; markFirstToken(content); queue() },
          }, controller.signal)
          if (cancelled || selection !== selectionVersion.current) return
          if (result === 'completed') {
            flush()
            const completedAt = Date.now()
            setMessages((current) => current
              .map((message, index) => index === run.assistantMessageIndex && message.timing
                ? { ...message, timing: { ...message.timing, firstTokenAt, completedAt } }
                : message)
              .filter((message) => message.content.trim().length > 0))
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
            setMessages((current) => current.filter((message) => message.content.trim().length > 0))
            setError(caught.message)
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
  }, [activeRun, isOpen])

  function startNewConversation() {
    if (isStarting || conversationLoading || renameBusy) return
    ++selectionVersion.current
    streamControllerRef.current?.abort()
    setActiveRun(null)
    setConversationId(null)
    setConversation(null)
    setConfirmingAction(null)
    hydrated.current = null
    setHistoryOpen(false)
    setRenaming(false)
    setMessages(initialAssistantMessages())
    setDraft('')
    setError(null)
    setStreamStatus(null)
    setModelMenuOpen(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    const token = getStoredAuthToken(studioAuthTokenKey)
    if (!content || isBusy || !token) return
    const nextMessages: AiChatMessage[] = [
      ...messages.filter((message) => message.content.trim().length > 0).map(({ role, content: messageContent }) => ({ role, content: messageContent })),
      { role: 'user', content },
    ]
    if (!conversationId && nextMessages.length > 40) {
      setError('当前对话已达到 40 条消息上限，请新建对话后继续。')
      return
    }
    const assistantMessageIndex = nextMessages.length
    shouldStickToBottomRef.current = true
    setMessages([...nextMessages, { role: 'assistant', content: '', timing: { startedAt: Date.now() } }])
    setDraft('')
    setError(null)
    setStreamStatus('正在创建生成任务…')
    setIsStarting(true)
    try {
      let id = conversationId
      if (!id) {
        const created = await createAiConversation(token)
        id = created.id
        hydrated.current = id
        setConversation(created)
        setConversationId(id)
      }
      const run = await createAiChatRun(token, {
        surface: 'studio',
        conversation_id: id,
        messages: [{ role: 'user', content }],
        provider,
        model: model || undefined,
        reasoning_effort: reasoning.effort,
        thinking_mode: reasoning.thinkingMode,
        execution_mode: executionMode,
        context: {
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
      })
      setActiveRun({ id: run.id, assistantMessageIndex })
      setStreamStatus('正在生成…')
    } catch (caught) {
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
    const token = getStoredAuthToken(studioAuthTokenKey)
    const completedAt = Date.now()
    const latest = activeReceivedRef.current
    streamControllerRef.current?.abort()
    setMessages((current) => current
      .map((message, index) => index === run.assistantMessageIndex
        ? {
            ...message,
            content: latest?.index === index ? latest.content : message.content,
            timing: message.timing ? { ...message.timing, completedAt } : undefined,
          }
        : message)
      .filter((message) => message.content.trim().length > 0))
    setActiveRun(null)
    setStreamStatus(null)
    setError(null)
    if (token) void cancelAiChatRun(token, run.id).catch(() => {
      setError('输出已在当前页面停止，但服务端取消请求失败。')
    })
  }

  const handleConfirmAction = useCallback(async (messageIndex: number, action: AiActionProposal) => {
    const token = getStoredAuthToken(studioAuthTokenKey)
    if (!token) return
    const selection = selectionVersion.current
    setConfirmingAction(messageIndex)
    try {
      await confirmAiAction(token, action.proposal_token)
      if (selection !== selectionVersion.current) return
      setMessages((current) => current.map((message, index) => index === messageIndex
        ? { ...message, content: `${message.content}\n\n✅ 已确认并执行：${action.action}` }
        : message))
    } catch (caught) {
      if (selection !== selectionVersion.current) return
      setError(caught instanceof Error ? caught.message : '操作执行失败，请稍后重试。')
    } finally {
      if (selection === selectionVersion.current) setConfirmingAction(null)
    }
  }, [])

  return (
    <div ref={rootRef} className={`studio-assistant${isOpen ? ' is-open' : ''}${expanded ? ' is-expanded' : ''}`}>
      {isOpen && !expanded && <button type="button" role="separator" aria-label="调整助手宽度" aria-orientation="vertical" aria-valuemin={340} aria-valuemax={600} aria-valuenow={panelWidth} className="studio-assistant__resize" title="拖动或用左右方向键调整宽度" onPointerDown={(event) => { resizeStart.current = { x: event.clientX, width: panelWidth }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => { const start = resizeStart.current; if (start) setPanelWidth(Math.max(340, Math.min(600, start.width + start.x - event.clientX))) }} onPointerUp={() => { resizeStart.current = null }} onPointerCancel={() => { resizeStart.current = null }} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setPanelWidth((width) => Math.max(340, Math.min(600, width + (event.key === 'ArrowLeft' ? 16 : -16)))) } }} />}
      {isOpen && (
        <section className={`studio-assistant__panel${messages.length === 1 && !isBusy ? ' is-empty' : ''}`} aria-label="博客 AI 助手">
          <header className="studio-assistant__header">
            <div className="studio-assistant__identity">
              <span className="studio-assistant__avatar"><StudioIcon name="assistant" /></span>
              <div><strong>博客助手</strong><span>构思 · 写作 · 整理</span></div>
            </div>
            <div className="studio-assistant__header-actions">
              <button type="button" aria-label="聊天历史" title="聊天历史" aria-expanded={historyOpen || expanded} onClick={() => { setHistoryOpen((open) => !open); setModelMenuOpen(false) }}><StudioIcon name="menu" /></button>
              <button className="studio-assistant__new-conversation" type="button" aria-label="新建对话" title="新建对话" disabled={isStarting || conversationLoading || renameBusy} onClick={startNewConversation}>
                <StudioIcon name="plus" />
              </button>
              <button type="button" aria-label={expanded ? '还原助手宽度' : '展开助手'} title={expanded ? '还原助手宽度' : '展开助手'} onClick={() => { setExpanded((value) => !value); setHistoryOpen(false) }}><StudioIcon name={expanded ? 'arrow-right' : 'arrow-up-right'} /></button>
              <button className="studio-assistant__close" type="button" aria-label="关闭 AI 助手" onClick={() => setIsOpen(false)}>
                <StudioIcon name="close" />
              </button>
            </div>
          </header>
          <div className={`studio-assistant__workspace${historyOpen ? ' is-history' : ''}`}>
          {(historyOpen || expanded) && <nav className="studio-assistant__history" aria-label="历史对话">
            <div className="studio-assistant__history-heading"><strong>历史对话</strong><button type="button" disabled={historyLoading} onClick={() => { void loadHistory() }}>刷新</button></div>
            {historyError && <div role="alert"><p>{historyError}</p><button type="button" onClick={() => { void loadHistory() }}>重试</button></div>}
            {!historyLoading && !historyError && history.length === 0 && <p className="studio-assistant__history-empty">还没有历史对话。发送第一条消息后，会自动保存在这里。</p>}
            {history.map((item) => <button key={item.id} type="button" className={`studio-assistant__history-item${item.id === conversationId ? ' is-selected' : ''}`} aria-current={item.id === conversationId ? 'true' : undefined} disabled={isStarting || conversationLoading || renameBusy} onClick={() => { void loadConversation(item.id) }}>
              <span>{item.title}</span><small>{new Date(item.updated_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}{item.title_source === 'pending' ? ' · 待命名' : ''}</small>
            </button>)}
            {historyLoading && <p role="status">正在读取历史…</p>}
            {hasMoreHistory && <button type="button" disabled={historyLoading} onClick={() => { void loadHistory(history.length) }}>加载更多</button>}
            {!expanded && <button type="button" className="studio-assistant__history-back" onClick={() => setHistoryOpen(false)}>返回当前对话</button>}
          </nav>}
          <div className="studio-assistant__chat">
          <div className="studio-assistant__conversation-heading">
            {renaming ? <form noValidate onSubmit={(event) => { void saveTitle(event) }}>
              <input autoFocus aria-label="对话标题" maxLength={80} value={titleDraft} disabled={renameBusy} onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && !renameBusy) setRenaming(false) }} />
              <button type="submit" disabled={renameBusy}>{renameBusy ? '保存中…' : '保存'}</button><button type="button" disabled={renameBusy} onClick={() => setRenaming(false)}>取消</button>
              {renameError && <p role="alert">{renameError}</p>}
            </form> : <><strong title={conversation?.title}>{conversation?.title ?? '新对话'}</strong><button type="button" disabled={!conversationId || conversationLoading} onClick={() => { setTitleDraft(conversation?.title ?? '新对话'); setRenameError(null); setRenaming(true) }}>重命名</button></>}
          </div>
          {conversationLoading && <p className="studio-assistant__loading" role="status">正在读取对话…</p>}
          {historyError && !historyOpen && <p className="studio-assistant__request-error" role="alert">{historyError}<button type="button" onClick={() => { if (conversationId) void loadConversation(conversationId) }}>重试</button></p>}
          <div
            className="studio-assistant__body"
            ref={bodyRef}
            onScroll={(event) => {
              const element = event.currentTarget
              const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight
              shouldStickToBottomRef.current = distanceToBottom <= 32
            }}
          >
            <div className="studio-assistant__context"><StudioIcon name="spark" /> {editor ? `当前文章：${editor.title || '未命名草稿'}` : `当前页面：${pageLabels[page.pageType]}`}</div>
            <div className="studio-assistant__messages">
              {messages.map((message, index) => (
                <div className={`studio-assistant__message studio-assistant__message--${message.role}`} key={`${message.role}-${index}`}>
                  {message.role === 'assistant' && <span className="studio-assistant__message-mark"><StudioIcon name="assistant" /></span>}
                  {message.role === 'assistant' ? <MarkdownMessage content={message.content} timing={message.timing} index={index} onConfirm={handleConfirmAction} confirming={confirmingAction === index} streaming={activeRun?.assistantMessageIndex === index || (isStarting && index === messages.length - 1)} onProgress={followOutput} /> : <p>{message.content}</p>}
                </div>
              ))}
            </div>
            {messages.length === 1 && (
              <div className="studio-assistant__suggestions">
                <span>你可以这样开始</span>
                {suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => handleSuggestion(suggestion)}>{suggestion}<StudioIcon name="arrow-up-right" /></button>)}
              </div>
            )}
          </div>
          <form className="studio-assistant__composer" noValidate onSubmit={(event) => { void submit(event) }}>
            <textarea
              aria-label="向博客助手提问"
              placeholder="告诉我你想完成什么…"
              rows={2}
              value={draft}
              disabled={conversationLoading}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }}
            />
            <div className="studio-assistant__composer-tools">
              <div className="studio-assistant__mode-switch" role="group" aria-label="Agent 执行方式">
                <button
                  className={executionMode === 'approval_required' ? 'is-active' : ''}
                  type="button"
                  aria-pressed={executionMode === 'approval_required'}
                  title="执行操作前先请求你的确认"
                  onClick={() => setExecutionMode('approval_required')}
                >审阅</button>
                <button
                  className={executionMode === 'automatic' ? 'is-active' : ''}
                  type="button"
                  aria-pressed={executionMode === 'automatic'}
                  title="允许助手自动执行已请求的操作"
                  onClick={() => setExecutionMode('automatic')}
                >自动</button>
              </div>
              <button ref={modelTriggerRef} aria-label="选择模型" title={model || '选择模型'} className="studio-assistant__tool-button" type="button" onClick={() => setModelMenuOpen((open) => !open)} aria-expanded={modelMenuOpen}>
                <ProviderIcon provider={provider} /><span className="studio-assistant__selected-model">{selectedModel?.name || model || '选择模型'}</span><span>{thinkingModeLabel(reasoning.thinkingMode) ?? reasoningEffortLabel(reasoning.effort)}</span><StudioIcon name="chevron" />
              </button>
              <span className="studio-assistant__context-ring" tabIndex={0} role={contextPercent === null ? 'img' : 'progressbar'} aria-label={contextDescription} aria-valuemin={contextPercent === null ? undefined : 0} aria-valuemax={contextPercent === null ? undefined : 100} aria-valuenow={contextPercent ?? undefined}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="studio-assistant__ring-track" cx="12" cy="12" r="9" />
                  {contextPercent !== null && <circle className="studio-assistant__ring-value" cx="12" cy="12" r="9" pathLength="100" strokeDasharray={`${contextPercent} 100`} transform="rotate(-90 12 12)" />}
                  {contextPercent === null && <text x="12" y="16" textAnchor="middle">?</text>}
                </svg>
                <span className="studio-assistant__ring-tooltip" aria-hidden="true">{contextDescription}</span>
              </span>
              {modelMenuOpen && <div ref={modelMenuRef} className="studio-assistant__model-menu">
                <AgentModelPicker provider={provider} models={models} model={model} loading={modelsLoading} disabled={isBusy} effort={reasoning.effort} onProviderChange={(next) => {
                  if (next === provider) return
                  setModelsLoading(true)
                  setProvider(next)
                  setModels(modelsCache.current[next] ?? [])
                  setModel(selectedModels.current[next] ?? modelsCache.current[next]?.[0]?.id ?? '')
                }} onModelChange={(next) => {
                  selectedModels.current[provider] = next
                  setModel(next)
                }} onEffortChange={reasoning.setEffort} thinkingMode={reasoning.thinkingMode} onThinkingModeChange={reasoning.setThinkingMode} />
              </div>}
              {activeRun
                ? <button className="studio-assistant__stop" type="button" aria-label="停止生成" onClick={stopGeneration}><StudioIcon name="stop" /></button>
                : <button type="submit" aria-label="发送消息" disabled={!draft.trim() || isBusy}><StudioIcon name="send" /></button>}
            </div>
            {!error && (isBusy || streamStatus) && <p className="studio-assistant__composer-status" role="status">{streamStatus ?? '正在生成…'}</p>}
            {error && <p className="studio-assistant__request-error" role="alert">{error}</p>}
          </form>
          </div>
          </div>
        </section>
      )}
      {!isOpen && <button className="studio-assistant__launcher" type="button" aria-expanded={isOpen} aria-label="打开博客 AI 助手" onClick={() => setIsOpen(true)}>
        <span className="studio-assistant__launcher-icon"><StudioIcon name={isOpen ? 'close' : 'assistant'} /></span>
        <span className="studio-assistant__launcher-copy"><strong>{isOpen ? '收起助手' : '博客助手'}</strong><small>{isOpen ? '继续当前工作' : '当前模块的创作搭档'}</small></span>
        {!isOpen && <span className="studio-assistant__launcher-signal" />}
      </button>}
    </div>
  )
}
