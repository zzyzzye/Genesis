import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { MediaAssistant } from '../src/pages/media/MediaAssistant'
import { streamAiChat } from '../src/lib/api'

vi.mock('../src/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  getProviderModels: vi.fn().mockResolvedValue({ models: [] }),
  streamAiChat: vi.fn(),
}))

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('影音澄清卡片自定义回答失败后可重试，成功沿用对话并锁定旧题', async () => {
  const block = '\n```user-question\n' + JSON.stringify({ id: 'media-question', questions: [{
    question: '想做哪种风格？', options: [],
  }] }) + '\n```'
  vi.mocked(streamAiChat).mockImplementationOnce((_token, _request, onToken) => {
    onToken(block)
    return Promise.resolve()
  }).mockRejectedValueOnce(new Error('模拟网络失败')).mockImplementationOnce((_token, _request, onToken) => {
    onToken('按纪录片方向继续。')
    return Promise.resolve()
  })
  render(<MediaAssistant token="test-placeholder" page="projects" selectedNode={null} />)
  fireEvent.click(screen.getByRole('button', { name: '镜头搭档' }))
  fireEvent.change(screen.getByRole('textbox', { name: '向镜头搭档提问' }), { target: { value: '帮我做个视频' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给镜头搭档' }))
  fireEvent.change(await screen.findByRole('textbox', { name: '自定义回答：想做哪种风格？' }), { target: { value: '纪录片' } })
  fireEvent.click(screen.getByRole('button', { name: '继续' }))
  expect(await screen.findByText('模拟网络失败')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '自定义回答：想做哪种风格？' })).toHaveValue('纪录片')
  fireEvent.click(screen.getByRole('button', { name: '继续' }))
  expect(await screen.findByText('按纪录片方向继续。')).toBeInTheDocument()
  expect(screen.getByText('已询问')).toBeInTheDocument()
  expect(screen.getByText('纪录片')).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: '自定义回答：想做哪种风格？' })).not.toBeInTheDocument()
  expect(vi.mocked(streamAiChat).mock.calls.at(-1)?.[1].messages).toEqual([
    { role: 'user', content: '帮我做个视频' },
    { role: 'assistant', content: block },
    { role: 'user', content: '想做哪种风格？\n纪录片' },
  ])
})
