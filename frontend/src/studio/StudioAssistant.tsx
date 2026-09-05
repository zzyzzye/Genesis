import { type FormEvent, useState } from 'react'

import { StudioIcon } from './StudioIcon'

type AssistantMessage = { role: 'assistant' | 'user'; content: string }

const suggestions = ['帮我梳理今天的写作计划', '把这篇文章改得更有力量', '生成一个文章标题']

export function StudioAssistant() {
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<AssistantMessage[]>([
    { role: 'assistant', content: '你好，我是 Genesis 助手。\n我可以帮你构思、改写和整理内容。' },
  ])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content) return
    setMessages((current) => [
      ...current,
      { role: 'user', content },
      { role: 'assistant', content: '收到。Agent 接入后，我会在这里继续处理你的写作任务。' },
    ])
    setDraft('')
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
          <form className="studio-assistant__composer" onSubmit={submit}>
            <textarea aria-label="向 Genesis AI 提问" placeholder="告诉我你想完成什么…" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} />
            <div><span><StudioIcon name="attachment" /> Agent 即将接入</span><button type="submit" aria-label="发送消息" disabled={!draft.trim()}><StudioIcon name="send" /></button></div>
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

