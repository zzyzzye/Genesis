import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { BlogActionProposal } from '../src/features/blog/agent/BlogActionProposal'
import type { AiActionProposal } from '../src/lib/api'

afterEach(cleanup)

it('定时发布显示分类标签、带时区的计划时间和真实执行状态', () => {
  const action: AiActionProposal = {
    type: 'pending_action', module: 'blog', action: 'create_draft', proposal_id: 'schedule-1',
    payload: { title: '计划发布文章', category_ids: ['one', 'two'], category_names: ['工程', '写作'], tags: [{ name: 'Agent', slug: 'agent' }], scheduled_at: '2099-01-01T09:00:00+08:00', content_markdown: '最终正文' },
    summary: '创建草稿', expires_at: '2099-01-01T00:00:00Z', proposal_token: 'test', requires_confirmation: true,
  }
  const onConfirm = vi.fn()
  const view = render(<BlogActionProposal action={action} executed={false} busy={false} disabled={false} onConfirm={onConfirm} />)
  expect(screen.getByRole('region', { name: '创建并定时发布' })).toBeInTheDocument()
  expect(screen.getByText('分类：工程、写作')).toBeInTheDocument()
  expect(screen.getByText('标签：Agent')).toBeInTheDocument()
  expect(view.container.querySelector('time')).toHaveAttribute('datetime', '2099-01-01T09:00:00+08:00')
  fireEvent.click(screen.getByRole('button', { name: '确认定时发布' }))
  expect(onConfirm).toHaveBeenCalledOnce()
  view.rerender(<BlogActionProposal action={action} executed={false} busy disabled={false} onConfirm={onConfirm} />)
  expect(screen.getByRole('button', { name: '执行中…' })).toBeDisabled()
  view.rerender(<BlogActionProposal action={action} executed busy={false} disabled={false} onConfirm={onConfirm} />)
  expect(screen.getByText('发布计划已保存')).toBeInTheDocument()
  expect(screen.queryByText('文章已发布')).not.toBeInTheDocument()
})

it('取消计划、立即发布和撤回使用对应的动作名称', () => {
  const action: AiActionProposal = {
    type: 'pending_action', module: 'blog', action: 'update_post', proposal_id: 'update-1',
    payload: { target_title: '已有文章', target_status: 'draft', changes: JSON.stringify({ scheduled_at: null, category_ids: [], tags: [] }), category_names: [] },
    summary: '更新', expires_at: '2099-01-01T00:00:00Z', proposal_token: 'test', requires_confirmation: true,
  }
  const props = { executed: false, busy: false, disabled: false, onConfirm: vi.fn() }
  const view = render(<BlogActionProposal action={action} {...props} />)
  expect(screen.getByRole('button', { name: '确认取消计划' })).toBeInTheDocument()
  expect(screen.getByText('分类：暂不分类')).toBeInTheDocument()
  expect(screen.getByText('标签：无标签')).toBeInTheDocument()
  view.rerender(<BlogActionProposal action={{ ...action, payload: { ...action.payload, changes: { status: 'published' } } }} {...props} />)
  expect(screen.getByRole('region', { name: '更新并发布文章' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '确认发布' })).toBeInTheDocument()
  view.rerender(<BlogActionProposal action={{ ...action, payload: { ...action.payload, target_status: 'published', changes: { status: 'draft', scheduled_at: null } } }} {...props} />)
  expect(screen.getByRole('region', { name: '撤回文章' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '确认撤回' })).toBeInTheDocument()
})

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
