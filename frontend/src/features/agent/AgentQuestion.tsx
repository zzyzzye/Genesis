import { useRef, useState } from 'react'
import { ChevronDown, MessageSquare } from 'lucide-react'

import { questionAnswers, type QuestionRequest } from './questionProtocol'
import './AgentQuestion.css'

export function AgentQuestion({ request, disabled, answered, answerContent, onAnswer }: {
  request: QuestionRequest
  disabled: boolean
  answered: boolean
  answerContent?: string
  onAnswer: (answer: string) => void
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [custom, setCustom] = useState<Record<number, string>>({})
  const submitRef = useRef(false)
  const complete = request.questions.every((_, index) => (custom[index]?.trim() || answers[index]?.trim()))
  const locked = disabled || answered
  if (answered) {
    const submitted = questionAnswers(request, answerContent)
    return <details className="agent-question agent-question--answered" open>
      <summary><MessageSquare aria-hidden="true" /><span>已询问</span><ChevronDown className="agent-question__chevron" aria-hidden="true" /></summary>
      <ul className="agent-question__answers">{request.questions.map((question, index) => <li key={index}>
        <p>{question.question}</p>
        <p>{submitted?.[index] ?? '未单独回答，可在聊天中补充。'}</p>
      </li>)}</ul>
    </details>
  }
  return <form className="agent-question" aria-label="补充关键信息" noValidate onSubmit={(event) => {
    event.preventDefault()
    if (locked || !complete || submitRef.current) return
    submitRef.current = true
    const answer = request.questions.map((question, index) => `${question.question}\n${custom[index]?.trim() || answers[index]}`).join('\n\n')
    onAnswer(answer)
    // 父级提交失败后可再次回答；同一事件内拦截重复提交。
    queueMicrotask(() => { submitRef.current = false })
  }}>
    {request.questions.map((question, index) => <fieldset key={index} disabled={locked}>
      <legend>{question.question}</legend>
      {question.options.length > 0 && <div className="agent-question__options" role="group" aria-label={question.question}>
        {question.options.map((option) => <button type="button" key={option.label} aria-pressed={!custom[index]?.trim() && answers[index] === option.label} onClick={() => {
          setAnswers((current) => ({ ...current, [index]: option.label }))
          setCustom((current) => ({ ...current, [index]: '' }))
        }}><span>{option.label}{option.recommended && <small>推荐</small>}</span><span>{option.description}</span></button>)}
      </div>}
      <label><span>{question.options.length ? '或自行填写' : '你的回答'}</span><textarea className="resize-none" aria-label={`自定义回答：${question.question}`} rows={2} maxLength={2000} placeholder="写下你的想法…" value={custom[index] ?? ''} onChange={(event) => {
        const value = event.target.value
        setCustom((current) => ({ ...current, [index]: value }))
      }} /></label>
    </fieldset>)}
    <div className="agent-question__footer"><span>选择方向或自行填写后继续</span><button type="submit" disabled={locked || !complete}>{disabled ? '请稍候…' : '继续'}</button></div>
  </form>
}
