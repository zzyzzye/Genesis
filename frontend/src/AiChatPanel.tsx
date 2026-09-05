import { type FormEvent, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { streamAiChat, type AiChatContext, type AiChatMessage, type AiSurface } from './lib/api'

export function AiChatPanel({
  token,
  surface,
  context,
  title = 'Genesis AI',
}: {
  token: string | null
  surface: AiSurface
  context?: AiChatContext
  title?: string
}) {
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = input.trim()
    if (!content || busy) return
    if (!token) {
      setError('请先登录后使用 Genesis AI。')
      return
    }
    const nextMessages: AiChatMessage[] = [...messages, { role: 'user', content }]
    setMessages([...nextMessages, { role: 'assistant', content: '' }])
    setInput('')
    setError(null)
    setBusy(true)
    try {
      await streamAiChat(token, { surface, messages: nextMessages, context }, (tokenText) => {
        setMessages((current) => {
          const last = current.at(-1)
          if (!last || last.role !== 'assistant') return current
          return [...current.slice(0, -1), { ...last, content: last.content + tokenText }]
        })
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'AI 生成失败，请稍后再试。')
      setMessages((current) => current.filter((message, index) => !(index === current.length - 1 && message.role === 'assistant' && !message.content)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ai-panel" aria-labelledby="ai-panel-title">
      <div className="ai-panel__heading">
        <div><p className="eyebrow">GENESIS / AI</p><h2 id="ai-panel-title">{title}</h2></div>
        <button type="button" onClick={() => setMessages([])} disabled={busy || messages.length === 0}>清空</button>
      </div>
      <div className="ai-panel__messages" aria-live="polite">
        {messages.length === 0 && <p className="ai-panel__empty">告诉我你想整理、改写或生成什么。</p>}
        {messages.map((message, index) => (
          <div className={`ai-message ai-message--${message.role}`} key={`${message.role}-${index}`}>
            {message.role === 'assistant' ? <Markdown remarkPlugins={[remarkGfm]}>{message.content || '正在生成…'}</Markdown> : <p>{message.content}</p>}
          </div>
        ))}
      </div>
      {error && <p className="ai-panel__error" role="alert">{error}</p>}
      <form className="ai-panel__form" onSubmit={(event) => { void submit(event) }}>
        <textarea value={input} onChange={(event) => setInput(event.currentTarget.value)} placeholder="和 Genesis AI 说点什么…" rows={3} disabled={busy} />
        <button className="primary-button" type="submit" disabled={busy || !input.trim()}>{busy ? '生成中…' : '发送'}</button>
      </form>
    </section>
  )
}

