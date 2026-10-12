import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArticleGuide } from '../src/features/blog/ArticleGuide'
import { getBlogArticleGuide, type BlogArticleGuide } from '../src/lib/api'

vi.mock('../src/lib/api', () => ({ getBlogArticleGuide: vi.fn() }))
const ready: BlogArticleGuide = { status: 'ready', key_points: ['保存当前文章。', '版本变化会刷新导读。', '失败不影响正文阅读。'], reading_focus: '重点查看版本变化后的缓存处理。' }
function trigger() { return screen.getByRole('button', { name: /AI 导读/ }) }
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers() })

describe('公开文章 AI 导读', () => {
  it('默认收起，展开读取对应版本，收起后再次展开复用结果', async () => {
    vi.mocked(getBlogArticleGuide).mockResolvedValue(ready)
    render(<ArticleGuide slug="article" revision="version" />)
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(getBlogArticleGuide).not.toHaveBeenCalled()
    fireEvent.click(trigger())
    expect(await screen.findByRole('list', { name: '文章关键要点' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: '显示全部' })).not.toBeInTheDocument())
    expect(screen.getByText(ready.reading_focus)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(getBlogArticleGuide).toHaveBeenCalledWith('article', 'version', expect.any(AbortSignal))
    fireEvent.click(trigger())
    expect(document.getElementById(trigger().getAttribute('aria-controls')!)).toHaveAttribute('inert')
    fireEvent.click(trigger())
    expect(await screen.findByRole('list')).toBeInTheDocument()
    expect(screen.getByText(ready.reading_focus)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '显示全部' })).not.toBeInTheDocument()
    expect(getBlogArticleGuide).toHaveBeenCalledTimes(1)
  })

  it.each(['跳过', '收起'])('逐字呈现中%s，再次展开直接阅读全部', async (action) => {
    vi.mocked(getBlogArticleGuide).mockResolvedValue({ ...ready, key_points: ['长段内容😀'.repeat(20), ...ready.key_points.slice(1)] })
    render(<ArticleGuide slug="article" />)
    fireEvent.click(trigger())
    const skip = await screen.findByRole('button', { name: '显示全部' })
    if (action === '跳过') {
      fireEvent.click(skip)
      expect(screen.getByText(ready.reading_focus)).toBeInTheDocument()
      fireEvent.click(trigger())
    } else fireEvent.click(trigger())
    fireEvent.click(trigger())
    expect(screen.queryByRole('button', { name: '显示全部' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText(ready.reading_focus)).toBeInTheDocument()
    expect(getBlogArticleGuide).toHaveBeenCalledTimes(1)
  })

  it('失败可以重试，等待生成时只在手动重新查看后读取', async () => {
    vi.mocked(getBlogArticleGuide).mockRejectedValueOnce(new Error('读取失败'))
      .mockResolvedValueOnce({ status: 'pending', key_points: [], reading_focus: '' })
      .mockResolvedValueOnce(ready)
    render(<ArticleGuide slug="article" />)
    fireEvent.click(trigger())
    expect(await screen.findByRole('alert')).toHaveTextContent('文章仍可正常阅读')
    fireEvent.click(screen.getByRole('button', { name: '重新加载导读' }))
    expect(await screen.findByRole('status')).toHaveTextContent('导读正在准备')
    expect(getBlogArticleGuide).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '重新查看导读' }))
    expect(await screen.findByRole('list')).toBeInTheDocument()
    expect(getBlogArticleGuide).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['unavailable', '这篇文章暂时没有导读，可以直接阅读正文。'],
    ['outdated', '文章已更新，刷新页面后可查看对应版本的导读。'],
  ] as const)('%s 明确说明，不展示旧要点', async (status, message) => {
    vi.mocked(getBlogArticleGuide).mockResolvedValue({ status, key_points: [], reading_focus: '' })
    render(<ArticleGuide slug="article" />)
    fireEvent.click(trigger())
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('收起时取消读取，迟到结果不会成为缓存，换文章重新收起', async () => {
    let finish: (value: BlogArticleGuide) => void = () => {}
    vi.mocked(getBlogArticleGuide).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockResolvedValueOnce(ready)
    const view = render(<ArticleGuide key="one" slug="one" />)
    fireEvent.click(trigger())
    await waitFor(() => expect(getBlogArticleGuide).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(getBlogArticleGuide).mock.calls[0]![2]!
    fireEvent.click(trigger())
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(ready); await Promise.resolve() })
    fireEvent.click(trigger())
    expect(await screen.findByRole('list')).toBeInTheDocument()
    expect(getBlogArticleGuide).toHaveBeenCalledTimes(2)
    view.rerender(<ArticleGuide key="two" slug="two" revision="new" />)
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('读取超过十二秒停止等待并允许重试', async () => {
    vi.useFakeTimers()
    vi.mocked(getBlogArticleGuide).mockImplementation(() => new Promise(() => {}))
    render(<ArticleGuide slug="article" />)
    fireEvent.click(trigger())
    await act(async () => { await vi.advanceTimersByTimeAsync(12001) })
    expect(screen.getByRole('alert')).toHaveTextContent('暂时未能加载')
    expect(vi.mocked(getBlogArticleGuide).mock.calls[0]![2]!.aborted).toBe(true)
    expect(screen.getByRole('button', { name: '重新加载导读' })).toBeInTheDocument()
  })
})
