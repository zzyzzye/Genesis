import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { BlogActionProposal } from '../src/features/blog/agent/BlogActionProposal'
import type { AiActionProposal } from '../src/lib/api'

afterEach(cleanup)

const action: AiActionProposal = { action: 'create_draft', type: 'pending_action', module: 'blog', proposal_id: 'draft', payload: { title: '新文章', excerpt: '文章摘要', content_markdown: '# 正文标题\n\n文章内容' }, summary: '确认create_draft操作', requires_confirmation: true, expires_at: '2099-01-01', proposal_token: 'test-proposal' }

it('明确说明创建新草稿，可展开正文预览，查看预览不会执行操作', () => {
  const onConfirm = vi.fn()
  render(<BlogActionProposal action={action} executed={false} busy={false} disabled={false} onConfirm={onConfirm} />)
  expect(screen.getByText('创建新草稿')).toBeInTheDocument()
  expect(screen.getByText('新文章')).toBeInTheDocument()
  expect(screen.getByText('保存为一篇新的草稿')).toBeInTheDocument()
  fireEvent.click(screen.getByText('查看正文预览'))
  expect(screen.getByRole('heading', { name: '正文标题' })).toBeVisible()
  expect(onConfirm).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认创建' }))
  expect(onConfirm).toHaveBeenCalledOnce()
})

it('更新显示真实目标和修改字段，执行中与完成时禁用确认', () => {
  const update: AiActionProposal = { ...action, action: 'update_post', payload: { post_id: 'post-1', changes: JSON.stringify({ excerpt: '新摘要', content_markdown: '新正文' }) } }
  const props = { action: update, targetPost: { id: 'post-1', title: '已有文章' }, executed: false, busy: true, disabled: false, onConfirm: vi.fn() }
  const view = render(<BlogActionProposal {...props} />)
  expect(screen.getByText('已有文章')).toBeInTheDocument()
  expect(screen.getByText(/修改摘要、正文/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '执行中…' })).toBeDisabled()
  view.rerender(<BlogActionProposal {...props} busy={false} executed />)
  expect(screen.getByText('文章已更新')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '已完成' })).toBeDisabled()
})

it('删除说明不可撤销，目标不匹配时不借用当前文章标题，无内容时不显示预览', () => {
  render(<BlogActionProposal action={{ ...action, action: 'delete_post', payload: { post_id: 'another-id' } }} targetPost={{ id: 'current', title: '不相关文章' }} executed={false} busy={false} disabled onConfirm={vi.fn()} />)
  expect(screen.getByText(/此操作无法撤销/)).toBeInTheDocument()
  expect(screen.queryByText('不相关文章')).not.toBeInTheDocument()
  expect(screen.queryByText('查看正文预览')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '确认删除' })).toBeDisabled()
})
