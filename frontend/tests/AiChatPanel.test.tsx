import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AiChatPanel } from '../src/AiChatPanel'
import { streamAiChat } from '../src/lib/api'

vi.mock('../src/lib/api', () => ({ streamAiChat: vi.fn() }))
afterEach(() => vi.resetAllMocks())

it('对话表单由应用校验，未登录不发送，有请求时同步阻止重复提交', async () => {
  const view = render(<AiChatPanel token={null} surface="toolbox" />)
  const form = screen.getByRole('form', { name: 'Genesis AI 对话' })
  expect(form).toHaveAttribute('novalidate')
  const input = screen.getByRole('textbox', { name: '向 Genesis AI 提问' })
  expect(input).toHaveClass('resize-none')
  fireEvent.change(input, { target: { value: '整理思路' } })
  fireEvent.submit(form)
  expect(screen.getByRole('alert')).toHaveTextContent('请先登录')
  expect(streamAiChat).not.toHaveBeenCalled()
  view.rerender(<AiChatPanel token="test-session" surface="toolbox" />)
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  vi.mocked(streamAiChat).mockReturnValue(pending)
  fireEvent.submit(form); fireEvent.submit(form)
  expect(streamAiChat).toHaveBeenCalledOnce()
  expect(input).toBeDisabled()
  await act(async () => { finish(); await pending })
  expect(input).toBeEnabled()
})
