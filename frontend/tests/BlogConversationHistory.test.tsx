import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BlogConversationHistory } from '../src/features/blog/agent/BlogConversationHistory'
import type { AiConversation } from '../src/lib/api'

const entries: AiConversation[] = ['第一段规划', '第二段改写'].map((title, index) => ({
  id: `history-${index}`, title, title_source: 'manual',
  created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z',
}))

function setup() {
  const props = {
    history: entries, currentId: entries[0]!.id, loading: false, error: null,
    hasMore: true, disabled: false, expanded: true,
    onReload: vi.fn(), onLoadMore: vi.fn(), onOpen: vi.fn(), onBack: vi.fn(),
    onDelete: vi.fn().mockResolvedValue(1),
  }
  const view = render(<BlogConversationHistory {...props} />)
  return { ...view, props }
}

describe('博客历史批量删除', () => {
  it('逐条选择只删除指定历史，确认先聚焦取消，取消不发起请求', async () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }))
    expect(screen.getByRole('button', { name: '删除所选' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /第一段规划/ }))
    expect(screen.getByRole('checkbox', { name: '选择对话：第一段规划' })).toBeChecked()
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: '全选全部历史对话' })).toBePartiallyChecked()
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('所选的 1 段历史对话')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(props.onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: '选择对话：第一段规划' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith({ scope: 'selected', ids: ['history-0'] }))
    expect(await screen.findByRole('status')).toHaveTextContent('已删除 1 段')
  })

  it('全选包含未加载记录，允许排除某段，加载更多后保持全选语义', async () => {
    const { props, rerender } = setup()
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '全选全部历史对话' }))
    expect(screen.getByRole('checkbox', { name: '选择对话：第二段改写' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(props.onLoadMore).toHaveBeenCalledOnce()
    const third = { ...entries[0]!, id: 'history-2', title: '后续分页' }
    rerender(<BlogConversationHistory {...props} history={[...entries, third]} />)
    expect(screen.getByRole('checkbox', { name: '选择对话：后续分页' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择对话：第二段改写' }))
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('包括尚未加载的记录，保留你已取消勾选的 1 段')
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith({ scope: 'all', excluded_ids: ['history-1'] }))
  })

  it('失败保留选择供重试，进行中阻止重复提交和关闭确认', async () => {
    const { props } = setup()
    let reject: (error: Error) => void = () => undefined
    props.onDelete.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '全选全部历史对话' }))
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(screen.getByRole('button', { name: '正在删除…' })).toBeDisabled()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(props.onDelete).toHaveBeenCalledOnce()
    await act(async () => { reject(new Error('所选对话仍在生成，请先停止。')); await Promise.resolve() })
    expect(await screen.findByRole('alert')).toHaveTextContent('仍在生成')
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledTimes(2))
    expect(props.onDelete).toHaveBeenLastCalledWith({ scope: 'all', excluded_ids: [] })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('空态不展示删除入口，取消全部勾选后不能删除', () => {
    const { props, rerender } = setup()
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '全选全部历史对话' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '全选全部历史对话' }))
    expect(screen.getByRole('button', { name: '删除所选' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    rerender(<BlogConversationHistory {...props} history={[]} hasMore={false} />)
    expect(screen.queryByRole('button', { name: '批量删除' })).not.toBeInTheDocument()
    expect(screen.getByText(/还没有历史对话/)).toBeInTheDocument()
  })
})
