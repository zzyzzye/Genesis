import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { BlogActionProposal } from '../src/features/blog/agent/BlogActionProposal'
import type { AiActionProposal } from '../src/lib/api'

afterEach(cleanup)

it('创建并发布只提供一次发布确认，完整展示最终内容', () => {
  const action: AiActionProposal = { type: 'pending_action', module: 'blog', action: 'create_and_publish', proposal_id: 'publish-1', payload: { title: '直接发布文章', excerpt: '摘要', content_markdown: '最终正文', slug: 'direct-publish' }, summary: '创建并发布', expires_at: '2099-01-01T00:00:00Z', proposal_token: 'test', requires_confirmation: true }
  const onConfirm = vi.fn()
  const view = render(<BlogActionProposal action={action} executed={false} busy={false} disabled={false} onConfirm={onConfirm} />)
  expect(screen.getByRole('heading', { name: '直接发布文章' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '确认创建' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '确认发布' }))
  expect(onConfirm).toHaveBeenCalledOnce()
  view.rerender(<BlogActionProposal action={action} executed busy={false} disabled={false} onConfirm={onConfirm} />)
  expect(screen.getByText('文章已发布')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '已完成' })).toBeDisabled()
})

it('删除完成且没有当前文章时仍显示提议保存的文章名', () => {
  const action: AiActionProposal = {
    type: 'pending_action', module: 'blog', action: 'delete_post', proposal_id: 'delete-1',
    payload: { post_id: '1da4ed01', target_title: 'Linux 进程监控快捷命令速查' },
    summary: '删除文章', expires_at: '2099-01-01T00:00:00Z', proposal_token: 'test', requires_confirmation: true,
  }
  render(<BlogActionProposal action={action} executed busy={false} disabled={false} onConfirm={vi.fn()} />)
  expect(screen.getByRole('heading', { name: 'Linux 进程监控快捷命令速查' })).toBeInTheDocument()
  expect(screen.queryByText('目标文章 1da4ed01')).not.toBeInTheDocument()
  expect(screen.getByText('删除操作已完成')).toBeInTheDocument()
})

it('回收站回执与旧永久删除记录使用真实结果展示', () => {
  const action: AiActionProposal = { type: 'pending_action', module: 'blog', action: 'delete_post', proposal_id: 'trash-1', payload: { target_title: '可恢复文章' }, execution_result: { status: 'trashed' }, summary: '移入回收站', expires_at: '2099-01-01T00:00:00Z', proposal_token: 'test', requires_confirmation: true }
  const view = render(<BlogActionProposal action={action} executed busy={false} disabled={false} onConfirm={vi.fn()} />)
  expect(screen.getByText('文章已移入回收站')).toBeInTheDocument()
  view.rerender(<BlogActionProposal action={{ ...action, execution_result: { status: 'deleted' } }} executed busy={false} disabled={false} onConfirm={vi.fn()} />)
  expect(screen.getByText('文章已彻底删除')).toBeInTheDocument()
})
