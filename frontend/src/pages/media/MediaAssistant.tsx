import { ChevronDown, Clapperboard, Plus, Send, Sparkles, X } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { getProviderModels, streamAiChat, type AiChatMessage, type AiProvider, type AvailableModel } from '../../lib/api'

type MediaAssistantPage = 'projects' | 'project' | 'canvas' | 'assets'
export type MediaAssistantNode = { id: string; type: string; name: string; text: string; assetId: string | null }

const providers: AiProvider[] = ['openai', 'grok', 'gemini', 'claude', 'mimo']
const providerLabels: Record<AiProvider, string> = { openai: 'OpenAI', grok: 'Grok', gemini: 'Gemini', claude: 'Claude', mimo: 'MiMo' }
const promptsByPage: Record<MediaAssistantPage, string[]> = {
  projects: ['把一句想法拆成短片方案', '给我一个可拍的 6 镜头结构'],
  project: ['为这部作品规划镜头节奏', '列出还需要补齐的素材'],
  canvas: ['把当前想法拆成分镜', '检查镜头节奏与转场'],
  assets: ['给素材库一套命名与分组规则', '根据现有素材列拍摄补充清单'],
}
const pageLabels: Record<MediaAssistantPage, string> = { projects: '作品列表', project: '作品概览', canvas: '创作画布', assets: '素材库' }
const nodeTypeLabels: Record<string, string> = { video: '视频节点', note: '便签', text: '文本', shape: '形状', asset: '素材', group: '分组' }

function nodeLabel(node: MediaAssistantNode) { return node.name.trim() || node.text.trim().slice(0, 24) || nodeTypeLabels[node.type] || '节点' }
function formatContextWindow(value: number | null) {
  if (value === null) return null
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`
  return `${Math.round(value / 1000)}K`
}

export function MediaAssistant({ token, page, projectId, selectedNode }: {
  token: string | null
  page: MediaAssistantPage
  projectId?: string
  selectedNode: MediaAssistantNode | null
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [provider, setProvider] = useState<AiProvider>('openai')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<AvailableModel[]>([])
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [dismissedNodeId, setDismissedNodeId] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const modelCache = useRef<Partial<Record<AiProvider, AvailableModel[]>>>({})
  const selectedModels = useRef<Partial<Record<AiProvider, string>>>({})
  const prompts = promptsByPage[page]
  const discussionNode = selectedNode?.id === dismissedNodeId ? null : selectedNode
  const intro = useMemo(() => `我在${pageLabels[page]}。把一句想法、一个镜头或一批素材交给我，我会把它整理成下一步能做的事。`, [page])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (modelMenuOpen) { setModelMenuOpen(false); return }
      setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    inputRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [modelMenuOpen, open])

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
      let available = modelCache.current[provider]
      if (!available) {
        try { available = (await getProviderModels(authToken, provider)).models } catch { available = [] }
        modelCache.current[provider] = available
      }
      if (!active) return
      setModels(available)
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
      setMessages((current) => current.filter((message, index) => !(index === current.length - 1 && message.role === 'assistant' && !message.content)))
    } finally { setBusy(false) }
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void send(input) }
  function selectModel(next: string) { selectedModels.current[provider] = next; setModel(next); setModelMenuOpen(false) }
  function startNewConversation() { if (!busy) { setMessages([]); setInput(''); setError('') } }

  return <aside className={`media-agent${page === 'canvas' ? ' media-agent--canvas' : ''}`} aria-label="影音创作助手">
    {open && <section className="media-agent__panel" role="dialog" aria-label="镜头搭档">
      <header className="media-agent__header">
        <div className="media-agent__identity"><span className="media-agent__avatar"><Clapperboard aria-hidden="true" /></span><div><strong>镜头搭档</strong><span><i />在线 · 影音创作</span></div></div>
        <div className="media-agent__header-actions"><button type="button" aria-label="新建对话" disabled={busy} onClick={startNewConversation}><Plus aria-hidden="true" /></button><button type="button" className="media-agent__close" aria-label="关闭镜头搭档" onClick={() => setOpen(false)}><X aria-hidden="true" /></button></div>
      </header>
      <div className="media-agent__body">
        <div className="media-agent__context"><Sparkles aria-hidden="true" /><span>{pageLabels[page]} · 只给建议，不会改动画布</span></div>
        {discussionNode && <div className="media-agent__node-context"><span>正在讨论 · {nodeLabel(discussionNode)}</span><button type="button" aria-label="移除当前讨论节点" onClick={() => setDismissedNodeId(discussionNode.id)}><X aria-hidden="true" /></button></div>}
        <div className="media-agent__messages" aria-live="polite">
          {messages.length === 0 && <div className="media-agent__message media-agent__message--assistant"><span className="media-agent__message-mark"><Clapperboard aria-hidden="true" /></span><p>{intro}</p></div>}
          {messages.map((message, index) => <div className={`media-agent__message media-agent__message--${message.role}`} key={`${message.role}-${index}`}>{message.role === 'assistant' && <span className="media-agent__message-mark"><Clapperboard aria-hidden="true" /></span>}<div className="media-agent__response"><Markdown remarkPlugins={[remarkGfm]}>{message.role === 'assistant' ? message.content || '正在整理镜头…' : message.content}</Markdown></div></div>)}
        </div>
        {messages.length === 0 && <div className="media-agent__prompts" aria-label="快捷提问"><span>你可以这样开始</span>{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => void send(prompt)} disabled={busy}>{prompt}<span>↗</span></button>)}</div>}
      </div>
      <form className="media-agent__form" noValidate onSubmit={submit}>
        <textarea className="resize-none" ref={inputRef} aria-label="向镜头搭档提问" aria-keyshortcuts="Enter" rows={2} value={input} onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return; event.preventDefault(); event.currentTarget.form?.requestSubmit() }} disabled={busy} placeholder="告诉我你想拍成什么…（支持 Markdown，Enter 发送）" />
        <div className="media-agent__composer-tools"><button ref={modelTriggerRef} className="media-agent__model-trigger" type="button" aria-label="选择模型" aria-expanded={modelMenuOpen} onClick={() => setModelMenuOpen((value) => !value)}><span>{providerLabels[provider]}</span><i aria-hidden="true">·</i><strong>{model || '选择模型'}</strong><ChevronDown aria-hidden="true" /></button>
          {modelMenuOpen && <div ref={modelMenuRef} className="media-agent__model-menu" aria-label="模型列表"><div className="media-agent__provider-tabs" role="group" aria-label="选择供应商">{providers.map((item) => <button className={provider === item ? 'is-active' : ''} type="button" key={item} aria-pressed={provider === item} aria-label={`切换到 ${providerLabels[item]} 模型`} onClick={() => { setProvider(item); setModelMenuOpen(true) }}>{providerLabels[item]}</button>)}</div>{models.length ? <div className="media-agent__model-list" aria-label={`${providerLabels[provider]} 模型列表`}>{models.map((item) => <button className={`media-agent__model-option${model === item.id ? ' is-selected' : ''}`} type="button" key={item.id} aria-pressed={model === item.id} onClick={() => selectModel(item.id)}><span className="media-agent__model-name">{item.name || item.id}</span>{formatContextWindow(item.context_window) && <span className="media-agent__context-chip">{formatContextWindow(item.context_window)}</span>}</button>)}</div> : <p>当前服务商没有可用模型。</p>}</div>}
          <button className="media-agent__send" type="submit" aria-label="发送给镜头搭档" disabled={busy || !input.trim()}><Send aria-hidden="true" /></button>
        </div>{error && <p className="media-agent__error" role="alert">{error}</p>}
      </form>
    </section>}
    <button type="button" className="media-agent__launcher" aria-label={open ? '收起镜头搭档' : '镜头搭档'} aria-expanded={open} onClick={() => setOpen((value) => !value)}><span className="media-agent__launcher-icon"><Clapperboard aria-hidden="true" /></span><span className="media-agent__launcher-copy"><strong>{open ? '收起助手' : '镜头搭档'}</strong><small>{open ? '继续当前对话' : '当前画布的创作搭档'}</small></span></button>
  </aside>
}
