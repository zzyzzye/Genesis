import { type FormEvent, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { StudioIcon } from './StudioIcon'

function ProviderIcon({ provider }: { provider: AiProvider }) {
  const common = { viewBox: '0 0 24 24', role: 'img' as const, focusable: 'false' as const }

  if (provider === 'openai') {
    return <svg className={`provider-icon provider-icon--${provider}`} {...common} aria-label="OpenAI"><path d="M12 2.75a4.25 4.25 0 0 1 3.68 2.12 4.25 4.25 0 0 1 4.42 4.42A4.25 4.25 0 0 1 18 13a4.25 4.25 0 0 1-2.12 3.68 4.25 4.25 0 0 1-4.42 4.42A4.25 4.25 0 0 1 8 19a4.25 4.25 0 0 1-4.42-4.42A4.25 4.25 0 0 1 6 11a4.25 4.25 0 0 1 2.12-4.42A4.25 4.25 0 0 1 12 2.75Z" /><path d="m8.12 6.58 3.76 2.17v4.34l-3.76 2.17M15.88 6.58l-3.76 2.17M15.88 17.42l-3.76-2.17M6 11l3.76 2.17M18 13l-3.76-2.17" /></svg>
  }
  if (provider === 'grok') {
    return <svg className={`provider-icon provider-icon--${provider}`} {...common} aria-label="Grok"><path d="M5.1 4.2h3.2l10.6 15.6h-3.2L5.1 4.2Z" /><path d="M18.9 4.2h-3.2L5.1 19.8h3.2L18.9 4.2Z" /></svg>
  }
  if (provider === 'gemini') {
    return <svg className={`provider-icon provider-icon--${provider}`} {...common} aria-label="Gemini"><path d="M12 2.5c.56 4.84 2.66 7.08 7.5 7.5-4.84.56-7.08 2.66-7.5 7.5-.56-4.84-2.66-7.08-7.5-7.5 4.84-.42 6.94-2.66 7.5-7.5Z" /></svg>
  }
  return <svg className={`provider-icon provider-icon--${provider}`} {...common} aria-label="Claude"><path d="M7.05 14.08 10.7 5.1a2 2 0 0 1 3.72 1.52l-3.65 8.98a2 2 0 1 1-3.72-1.52Z" /><path d="m13.3 9.92 3.65 8.98a2 2 0 0 1-3.72 1.52l-3.65-8.98a2 2 0 0 1 3.72-1.52Z" /></svg>
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
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  useEffect(() => {
    const token = getStoredAuthToken(studioAuthTokenKey)
    if (!token || !isOpen) return
    void getProviderModels(token, provider)
      .then((result) => {
        setModels(result.models)
        setModel((current) => current && result.models.some((item) => item.id === current) ? current : result.models[0]?.id ?? '')
      })
      .catch(() => {
        setModels([])
        setModel('')
      })
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
                <div className="studio-assistant__provider-tabs">{(['openai', 'grok', 'gemini', 'claude'] as AiProvider[]).map((item) => <button key={item} type="button" className={provider === item ? 'is-active' : ''} onClick={() => { setProvider(item); setModelMenuOpen(false) }}>{item}</button>)}</div>
                {models.length === 0 ? <span className="studio-assistant__model-empty">暂无可用模型</span> : models.map((item) => <button key={item.id} type="button" onClick={() => { setModel(item.id); setModelMenuOpen(false) }}>{item.name || item.id}</button>)}
              </div>}
              <span className="studio-assistant__composer-status">{isBusy ? '正在生成…' : error ?? '单次会话'}</span>
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

