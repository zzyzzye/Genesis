import { useEffect, useId, useRef, useState } from 'react'
import { Check, CircleCheck, ChevronDown, ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react'

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
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const focusQuestion = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const submitRef = useRef(false)
  const progressId = useId()
  const completed = request.questions.map((_, index) => Boolean(custom[index]?.trim() || answers[index]?.trim()))
  const answeredCount = completed.filter(Boolean).length
  const firstUnanswered = completed.indexOf(false)
  const complete = firstUnanswered === -1
  const locked = disabled || answered
  useEffect(() => {
    if (!focusQuestion.current) return
    focusQuestion.current = false
    formRef.current?.querySelectorAll('fieldset')[currentQuestion]?.querySelector<HTMLElement>('button, textarea')?.focus({ preventScroll: true })
  }, [currentQuestion])

  function showQuestion(index: number, focus = false) {
    focusQuestion.current = focus
    setCurrentQuestion(index)
    if (focus && index === currentQuestion) {
      formRef.current?.querySelectorAll('fieldset')[index]?.querySelector<HTMLElement>('button, textarea')?.focus({ preventScroll: true })
    }
  }
  if (answered) {
    const submitted = questionAnswers(request, answerContent)
    return <details className="agent-question agent-question--answered" open>
      <summary>{submitted ? <CircleCheck aria-hidden="true" /> : <MessageSquare aria-hidden="true" />}<span>已询问</span><span className="agent-question__answer-count">{request.questions.length} 项</span><ChevronDown className="agent-question__chevron" aria-hidden="true" /></summary>
      <ul className="agent-question__answers">{request.questions.map((question, index) => <li key={index}>
        {submitted ? <Check className="agent-question__answer-icon" aria-hidden="true" /> : <MessageSquare className="agent-question__answer-icon" aria-hidden="true" />}
        <div><p>{question.question}</p>
        <p>{submitted?.[index] ?? '未单独回答，可在聊天中补充。'}</p></div>
      </li>)}</ul>
    </details>
  }
  return <form ref={formRef} className="agent-question" aria-label="补充关键信息" noValidate onSubmit={(event) => {
    event.preventDefault()
    if (locked || !complete || submitRef.current) return
    submitRef.current = true
    const answer = request.questions.map((question, index) => `${question.question}\n${custom[index]?.trim() || answers[index]}`).join('\n\n')
    onAnswer(answer)
    // 父级提交失败后可再次回答；同一事件内拦截重复提交。
    queueMicrotask(() => { submitRef.current = false })
  }}>
    <header className="agent-question__header"><span><MessageSquare aria-hidden="true" />需要你确认</span><span aria-live="polite" aria-atomic="true">第 {currentQuestion + 1} / {request.questions.length} 题</span></header>
    {request.questions.length > 1 && <nav className="agent-question__navigation" aria-label="切换问题" onKeyDown={(event) => {
      if (locked || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? request.questions.length - 1 : Math.max(0, Math.min(request.questions.length - 1, currentQuestion + (event.key === 'ArrowRight' ? 1 : -1)))
      showQuestion(next)
      event.currentTarget.querySelectorAll<HTMLButtonElement>('.agent-question__step')[next]?.focus()
    }}>
      <button type="button" aria-label="上一题" disabled={locked || currentQuestion === 0} onClick={() => showQuestion(currentQuestion - 1)}><ChevronLeft aria-hidden="true" /></button>
      <div>{request.questions.map((_, index) => <button type="button" className="agent-question__step" key={index} aria-label={`显示第 ${index + 1} 题，${completed[index] ? '已回答' : '待回答'}`} aria-current={index === currentQuestion ? 'step' : undefined} disabled={locked} onClick={() => showQuestion(index)}>{completed[index] ? <Check aria-hidden="true" /> : index + 1}</button>)}</div>
      <button type="button" aria-label="下一题" disabled={locked || currentQuestion === request.questions.length - 1} onClick={() => showQuestion(currentQuestion + 1)}><ChevronRight aria-hidden="true" /></button>
    </nav>}
    <div className="agent-question__slides">{request.questions.map((question, index) => <fieldset key={index} disabled={locked} hidden={index !== currentQuestion}>
      <legend><span className="agent-question__number">问题 {index + 1}/{request.questions.length} · {completed[index] ? '已回答' : '待回答'}</span>{question.question}</legend>
      {question.options.length > 0 && <div className="agent-question__options" role="group" aria-label={question.question}>
        {question.options.map((option) => <button type="button" key={option.label} aria-pressed={!custom[index]?.trim() && answers[index] === option.label} onClick={() => {
          setAnswers((current) => ({ ...current, [index]: option.label }))
          setCustom((current) => ({ ...current, [index]: '' }))
          if (index < request.questions.length - 1) showQuestion(index + 1, true)
        }}><span>{option.label}{option.recommended && <small>推荐</small>}{!custom[index]?.trim() && answers[index] === option.label && <Check className="agent-question__selected" aria-hidden="true" />}</span><span>{option.description}</span></button>)}
      </div>}
      <label><span>{question.options.length ? '或自行填写' : '你的回答'}</span><textarea className="resize-none" aria-label={`自定义回答：${question.question}`} rows={2} maxLength={2000} placeholder="写下你的想法…" value={custom[index] ?? ''} onChange={(event) => {
        const value = event.target.value
        setCustom((current) => ({ ...current, [index]: value }))
      }} /></label>
    </fieldset>)}</div>
    <div className="agent-question__footer">
      <div className="agent-question__progress">
        <span id={progressId} role="status">已回答 {answeredCount}/{request.questions.length} 题{complete ? (disabled ? '，请等待当前操作结束' : '，可以继续') : `，还有 ${request.questions.length - answeredCount} 题未回答`}</span>
        {!complete && <button type="button" className="agent-question__locate" disabled={locked} onClick={() => {
          showQuestion(firstUnanswered, true)
        }}>前往第 {firstUnanswered + 1} 题</button>}
      </div>
      <button type="submit" aria-describedby={progressId} disabled={locked || !complete}>{disabled ? '请稍候…' : '继续'}</button>
    </div>
  </form>
}
