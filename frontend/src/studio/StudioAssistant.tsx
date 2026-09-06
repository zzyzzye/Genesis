import { type FormEvent, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { StudioIcon } from './StudioIcon'

function ProviderIcon({ provider }: { provider: AiProvider }) {
  const common = { viewBox: '0 0 24 24', role: 'img' as const, focusable: 'false' as const }

  if (provider === 'openai') {
    return <svg className={`provider-icon provider-icon--${provider}`} {...common} aria-label="OpenAI 官方标识"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" /></svg>
  }
  if (provider === 'grok') {
    return <svg className={`provider-icon provider-icon--${provider}`} {...common} aria-label="Grok / xAI 官方标识"><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" /></svg>
  }
  if (provider === 'gemini') {
    return <svg className={`provider-icon provider-icon--${provider}`} {...common} aria-label="Google Gemini 官方标识"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" /></svg>
  }
  return <svg className={`provider-icon provider-icon--${provider}`} {...common} aria-label="Claude / Anthropic 官方标识"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" /></svg>
}

import { getProviderModels, streamAiChat, type AiChatMessage, type AiProvider } from '../lib/api'
import { getStoredAuthToken, studioAuthTokenKey } from '../lib/auth'

type AssistantMessage = { role: 'assistant' | 'user'; content: string }

function MarkdownMessage({ content }: { content: string }) {
  return <div className="studio-assistant__markdown"><Markdown remarkPlugins={[remarkGfm]}>{content || '正在生成…'}</Markdown></div>
}

const suggestions = ['帮我梳理今天的写作计划', '把这篇文章改得更有力量', '生成一个文章标题']

export function StudioAssistant() {
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<AiProvider>('openai')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<{ id: string; name: string | null }[]>([])
  const modelsCache = useRef<Partial<Record<AiProvider, { id: string; name: string | null }[]>>>({})
  const selectedModels = useRef<Partial<Record<AiProvider, string>>>({})
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  useEffect(() => {
    const token = getStoredAuthToken(studioAuthTokenKey)
    if (!token || !isOpen) return

    let cancelled = false
    const providers: AiProvider[] = ['openai', 'grok', 'gemini', 'claude']
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

  const [messages, setMessages] = useState<AssistantMessage[]>([
    { role: 'assistant', content: '你好，我是 Genesis 助手。\n我可以帮你构思、改写和整理内容。' },
  ])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    const token = getStoredAuthToken(studioAuthTokenKey)
    if (!content || isBusy || !token) return
    const nextMessages: AiChatMessage[] = [...messages, { role: 'user', content }]
    setMessages([...nextMessages, { role: 'assistant', content: '' }])
    setDraft('')
    setError(null)
    setIsBusy(true)
    try {
      await streamAiChat(token, { surface: 'studio', messages: nextMessages, provider, model: model || undefined }, (tokenText) => {
        setMessages((current) => {
          const last = current.at(-1)
          if (!last || last.role !== 'assistant') return current
          return [...current.slice(0, -1), { ...last, content: last.content + tokenText }]
        })
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'AI 请求失败，请稍后再试。')
    } finally {
      setIsBusy(false)
    }
  }

  function handleSuggestion(suggestion: string) {
    setDraft(suggestion)
  }

  return (
    <div className={`studio-assistant${isOpen ? ' is-open' : ''}`}>
      {isOpen && (
        <section className="studio-assistant__panel" aria-label="Genesis AI 助手">
          <header className="studio-assistant__header">
            <div className="studio-assistant__identity">
              <span className="studio-assistant__avatar"><StudioIcon name="assistant" /></span>
              <div><strong>Genesis AI</strong><span><i />在线 · 创作助手</span></div>
            </div>
            <button className="studio-assistant__close" type="button" aria-label="关闭 AI 助手" onClick={() => setIsOpen(false)}>
              <StudioIcon name="close" />
            </button>
          </header>
          <div className="studio-assistant__body">
            <div className="studio-assistant__context"><StudioIcon name="spark" /> 当前空间：写作台</div>
            <div className="studio-assistant__messages">
              {messages.map((message, index) => (
                <div className={`studio-assistant__message studio-assistant__message--${message.role}`} key={`${message.role}-${index}`}>
                  {message.role === 'assistant' && <span className="studio-assistant__message-mark"><StudioIcon name="assistant" /></span>}
                  {message.role === 'assistant' ? <MarkdownMessage content={message.content} /> : <p>{message.content}</p>}
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
          <form className="studio-assistant__composer" onSubmit={(event) => { void submit(event) }}>
            <textarea aria-label="向 Genesis AI 提问" placeholder="告诉我你想完成什么…" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} />
            <div className="studio-assistant__composer-tools">
              <button className="studio-assistant__tool-button" type="button" onClick={() => setModelMenuOpen((open) => !open)} aria-expanded={modelMenuOpen}>
                <ProviderIcon provider={provider} /> {model || '选择模型'} <StudioIcon name="chevron" />
              </button>
              {modelMenuOpen && <div className="studio-assistant__model-menu">
                <div className="studio-assistant__provider-tabs">{(['openai', 'grok', 'gemini', 'claude'] as AiProvider[]).map((item) => <button key={item} type="button" className={provider === item ? 'is-active' : ''} aria-label={`切换到 ${item} 模型`} onClick={() => { setProvider(item); setModels(modelsCache.current[item] ?? []); setModel(selectedModels.current[item] ?? modelsCache.current[item]?.[0]?.id ?? '') }}><ProviderIcon provider={item} /><span>{item}</span></button>)}</div>
                {models.length === 0 ? <span className="studio-assistant__model-empty">暂无可用模型</span> : models.map((item) => <button key={item.id} type="button" onClick={() => { selectedModels.current[provider] = item.id; setModel(item.id); setModelMenuOpen(false) }}>{item.name || item.id}</button>)}
              </div>}
              {(isBusy || error) && <span className="studio-assistant__composer-status">{isBusy ? '正在生成…' : error}</span>}
              <button type="submit" aria-label="发送消息" disabled={!draft.trim() || isBusy}><StudioIcon name="send" /></button>
            </div>
          </form>
        </section>
      )}
      <button className="studio-assistant__launcher" type="button" aria-expanded={isOpen} aria-label={isOpen ? '关闭 Genesis AI 助手' : '打开 Genesis AI 助手'} onClick={() => setIsOpen((open) => !open)}>
        <span className="studio-assistant__launcher-icon"><StudioIcon name={isOpen ? 'close' : 'assistant'} /></span>
        <span className="studio-assistant__launcher-copy"><strong>{isOpen ? '收起助手' : 'Genesis AI'}</strong><small>{isOpen ? '继续你的工作' : '你的创作搭档'}</small></span>
        {!isOpen && <span className="studio-assistant__launcher-signal" />}
      </button>
    </div>
  )
}

