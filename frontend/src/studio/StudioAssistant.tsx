import { type FormEvent, useEffect, useState } from 'react'

import { StudioIcon } from './StudioIcon'
import { getProviderModels, streamAiChat, type AiChatMessage, type AiProvider } from '../lib/api'
import { getStoredAuthToken, studioAuthTokenKey } from '../lib/auth'

type AssistantMessage = { role: 'assistant' | 'user'; content: string }

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
      await streamAiChat(token, { surface: 'studio', messages: nextMessages, model: model || undefined }, (tokenText) => {
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
                  <p>{message.content}</p>
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
                <StudioIcon name="assistant" /> {model || '选择模型'} <StudioIcon name="chevron" />
              </button>
              {modelMenuOpen && <div className="studio-assistant__model-menu">
                <div className="studio-assistant__provider-tabs">{(['openai', 'grok', 'claude'] as AiProvider[]).map((item) => <button key={item} type="button" className={provider === item ? 'is-active' : ''} onClick={() => { setProvider(item); setModelMenuOpen(false) }}>{item}</button>)}</div>
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

