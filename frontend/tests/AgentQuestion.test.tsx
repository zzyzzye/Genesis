import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { AgentQuestion } from '../src/features/agent/AgentQuestion'
import { questionAnswers, splitAgentQuestion, type QuestionRequest } from '../src/features/agent/questionProtocol'

const request: QuestionRequest = { id: 'question-1', questions: [{ question: '文章面向谁？', options: [
  { label: '入门读者', description: '补充背景与例子', recommended: true },
  { label: '专业读者', description: '直接讨论技术细节', recommended: false },
] }, { question: '想突出什么？', options: [] }] }

afterEach(cleanup)

it('完整选择后才提交，自定义回答优先且不会默认选择推荐项', () => {
  const onAnswer = vi.fn()
  render(<AgentQuestion request={request} disabled={false} answered={false} onAnswer={onAnswer} />)
  const submit = screen.getByRole('button', { name: '继续' })
  expect(submit).toBeDisabled()
  expect(screen.getByRole('button', { name: /入门读者/ })).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(screen.getByRole('button', { name: /入门读者/ }))
  expect(submit).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox', { name: '自定义回答：想突出什么？' }), { target: { value: '可持续写作' } })
  fireEvent.change(screen.getByRole('textbox', { name: '自定义回答：文章面向谁？' }), { target: { value: '有一定基础的创作者' } })
  expect(screen.getByRole('button', { name: /入门读者/ })).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(submit)
  fireEvent.click(submit)
  expect(onAnswer).toHaveBeenCalledTimes(1)
  expect(onAnswer).toHaveBeenCalledWith('文章面向谁？\n有一定基础的创作者\n\n想突出什么？\n可持续写作')
})

it('生成期间锁定选择，历史回答恢复为可折叠的问答摘要', () => {
  const view = render(<AgentQuestion request={request} disabled answered={false} onAnswer={vi.fn()} />)
  expect(screen.getByRole('button', { name: /入门读者/ })).toBeDisabled()
  view.rerender(<AgentQuestion request={request} disabled={false} answered answerContent={'文章面向谁？\n专业读者\n\n想突出什么？\n实际案例\n与经验'} onAnswer={vi.fn()} />)
  expect(screen.getByText('已询问')).toBeInTheDocument()
  expect(screen.getByText('专业读者')).toBeInTheDocument()
  expect(screen.getByText(/实际案例/)).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '继续' })).not.toBeInTheDocument()
  expect(view.container.querySelector('details')).toHaveAttribute('open')
})

it('普通后续聊天不被误当作卡片回答', () => {
  expect(questionAnswers(request, '继续吧')).toBeNull()
  expect(questionAnswers(request, '文章面向谁？\n专业读者')).toBeNull()
  render(<AgentQuestion request={request} disabled={false} answered answerContent="继续吧" onAnswer={vi.fn()} />)
  expect(screen.getAllByText('未单独回答，可在聊天中补充。')).toHaveLength(2)
})

it('流式、不合法与已完成的问题块不会泄漏 JSON，正常正文保留', () => {
  expect(splitAgentQuestion('普通回复')).toEqual({ text: '普通回复', request: null })
  expect(splitAgentQuestion('先确认方向\n```user-question\n{"id":')).toEqual({ text: '先确认方向', request: null })
  expect(splitAgentQuestion('```user-question\n非法\n```').request).toBeNull()
  expect(splitAgentQuestion('```user-question\n{"id":"bad","questions":[]}\n```').request).toBeNull()
  expect(splitAgentQuestion(`说明\n\`\`\`user-question\n${JSON.stringify(request)}\n\`\`\``)).toEqual({ text: '说明', request })
})
