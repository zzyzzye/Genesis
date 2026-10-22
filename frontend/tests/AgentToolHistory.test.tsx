import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgentToolHistory } from '../src/features/agent/AgentToolHistory'
import type { AiActionProposal, AiToolCall } from '../src/lib/api'

const call: AiToolCall = {
  id: 'call-1', name: 'get_post', label: '读取文章', status: 'succeeded',
  started_at: '2026-10-22T00:00:00Z', duration_ms: 320,
  input_summary: '1 项参数', parameter_names: ['post_id'], result_summary: '返回 1 项结果', proposal_id: null,
}

describe('工具调用历史', () => {
  it('默认一行，展开两级详情后可收起，不隐藏后续正文', () => {
    render(<><AgentToolHistory calls={[call]} /><p>助手正文</p></>)
    const summary = screen.getByText('调用了 1 个工具').closest('summary')!
    const history = summary.parentElement as HTMLDetailsElement
    expect(history.open).toBe(false)
    fireEvent.click(summary)
    expect(history.open).toBe(true)
    const item = screen.getByText('读取文章').closest('summary')!
    fireEvent.click(item)
    expect((item.parentElement as HTMLDetailsElement).open).toBe(true)
    expect(screen.getByText('post_id')).toBeVisible()
    expect(screen.getByText('返回 1 项结果')).toBeVisible()
    expect(screen.getByText('助手正文')).toBeVisible()
    fireEvent.click(summary)
    expect(history.open).toBe(false)
  })

  it('并行执行显示真实数量，结束后不强制改变用户的展开选择', () => {
    const running = [{ ...call, status: 'running' as const }, { ...call, id: 'call-2', status: 'running' as const }]
    const { rerender } = render(<AgentToolHistory calls={running} streaming />)
    const history = screen.getByText('正在读取文章…').closest('details') as HTMLDetailsElement
    fireEvent.click(history.querySelector('summary')!)
    expect(screen.getByText('2 项执行中')).toBeVisible()
    rerender(<AgentToolHistory calls={running.map(item => ({ ...item, status: 'succeeded' }))} />)
    expect(screen.getByText('全部完成')).toBeVisible()
    expect(history.open).toBe(true)
  })

  it('失败、中断与待确认可区分，确认回执会更新对应工具状态', () => {
    const pending = { ...call, status: 'awaiting_confirmation' as const, proposal_id: 'proposal-1' }
    const { rerender } = render(<AgentToolHistory calls={[pending]} />)
    expect(screen.getByText('1 项待确认')).toBeInTheDocument()
    rerender(<AgentToolHistory calls={[pending]} proposals={[{ proposal_id: 'proposal-1', executed: true } as AiActionProposal]} />)
    expect(screen.getByText('全部完成')).toBeInTheDocument()
    rerender(<AgentToolHistory calls={[{ ...call, status: 'failed' }]} />)
    expect(screen.getByText('1 项失败')).toBeInTheDocument()
    rerender(<AgentToolHistory calls={[{ ...call, status: 'running', duration_ms: null }]} />)
    expect(screen.getByText('1 项中断')).toBeInTheDocument()
    expect(screen.queryByText('0.0 秒')).not.toBeInTheDocument()
  })

  it('旧对话没有记录时不显示空入口', () => {
    const { container } = render(<AgentToolHistory calls={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('单个工具运行时显示执行中，不误报全部完成', () => {
    render(<AgentToolHistory calls={[{ ...call, status: 'running', duration_ms: null }]} streaming />)
    expect(screen.getByText('1 项执行中')).toBeInTheDocument()
    expect(screen.queryByText('全部完成')).not.toBeInTheDocument()
  })
})
