import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinksWorkspace } from '../src/studio/LinksWorkspace'
import { BlogLinks } from '../src/features/blog/BlogLinks'
import { deleteAdminBlogLink, getAdminBlogLinks, getPublicBlogLinks, saveAdminBlogLink, type BlogLink } from '../src/lib/api'

vi.mock('../src/lib/api', async (original) => ({
  ...await original<typeof import('../src/lib/api')>(),
  deleteAdminBlogLink: vi.fn(), getAdminBlogLinks: vi.fn(), getPublicBlogLinks: vi.fn(), saveAdminBlogLink: vi.fn(),
}))
const item: BlogLink = { id: 'link-1', name: '推荐网站', url: 'https://example.com/', description: '中文说明', sort_order: 2, is_visible: false, updated_at: '2026-10-11T00:00:00Z' }
function mount(query = '') {
  const callbacks = { onDirtyChange: vi.fn(), onPendingChange: vi.fn(), onCancelNavigation: vi.fn(), onConfirmNavigation: vi.fn() }
  return { ...render(<MemoryRouter initialEntries={['/blog/studio/links' + query]}><LinksWorkspace token="test-placeholder" {...callbacks} navigationBlocked={false} /></MemoryRouter>), ...callbacks }
}
beforeEach(() => { vi.mocked(getAdminBlogLinks).mockResolvedValue({ items: [item], total: 1 }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('站点链接管理', () => {
  it('校验失败与网络失败保留输入；默认隐藏，提交期间不重复写入', async () => {
    const view = mount()
    fireEvent.click(screen.getByRole('button', { name: '新增链接' }))
    expect(screen.getByRole('textbox', { name: '说明（可选）' }).tagName).toBe('TEXTAREA')
    const ids = [...view.container.querySelectorAll('[id]')].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    fireEvent.submit(view.container.querySelector('form')!)
    expect(saveAdminBlogLink).not.toHaveBeenCalled()
    expect(screen.getByText('请输入链接名称，最多 80 个字符。')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '新链接' } })
    fireEvent.change(screen.getByLabelText('链接地址'), { target: { value: 'https://example.com' } })
    vi.mocked(saveAdminBlogLink).mockRejectedValueOnce(new Error('保存失败'))
    fireEvent.submit(view.container.querySelector('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
    expect(screen.getByLabelText('名称')).toHaveValue('新链接')
    let resolve!: (value: BlogLink) => void
    vi.mocked(saveAdminBlogLink).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    fireEvent.submit(view.container.querySelector('form')!)
    fireEvent.submit(view.container.querySelector('form')!)
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()
    expect(saveAdminBlogLink).toHaveBeenCalledTimes(2)
    expect(vi.mocked(saveAdminBlogLink).mock.calls[1]?.[1]).toMatchObject({ name: '新链接', is_visible: false })
    await act(async () => { resolve({ ...item, name: '新链接' }); await Promise.resolve() })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(view.onPendingChange).toHaveBeenLastCalledWith(false)
  })

  it('编辑携带原版本，取消未保存修改先确认，继续编辑保留数据并恢复焦点', async () => {
    mount()
    const trigger = await screen.findByRole('button', { name: '编辑链接：推荐网站' })
    trigger.focus(); fireEvent.click(trigger)
    expect(screen.getByLabelText('名称')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '修改后的名称' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('button', { name: '继续编辑' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.getByLabelText('名称')).toHaveValue('修改后的名称')
    vi.mocked(saveAdminBlogLink).mockRejectedValueOnce(new Error('链接已被修改，请重新加载后再操作'))
    fireEvent.click(screen.getByRole('button', { name: '保存链接' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('链接已被修改')
    expect(saveAdminBlogLink).toHaveBeenCalledWith('test-placeholder', expect.objectContaining({ name: '修改后的名称' }), item)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('删除失败可重试，未确认不发送请求', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '删除链接：推荐网站' }))
    expect(deleteAdminBlogLink).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
    vi.mocked(deleteAdminBlogLink).mockRejectedValueOnce(new Error('网络不可用')).mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络不可用')
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteAdminBlogLink).toHaveBeenLastCalledWith('test-placeholder', item)
    await waitFor(() => expect(screen.getByLabelText('搜索链接')).toHaveFocus())
  })

  it('读取 URL 筛选与分页，空态可以清除筛选', async () => {
    vi.mocked(getAdminBlogLinks).mockResolvedValue({ items: [], total: 41 })
    mount('?q=测试&visibility=hidden&page=2')
    expect(await screen.findByText('没有匹配的链接')).toBeInTheDocument()
    expect(getAdminBlogLinks).toHaveBeenCalledWith('test-placeholder', '测试', 2, 'hidden', expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    await waitFor(() => expect(getAdminBlogLinks).toHaveBeenLastCalledWith('test-placeholder', '', 1, 'all', expect.any(AbortSignal)))
  })
})

describe('公开站点链接', () => {
  it('失败可以重试，分页追加，外链使用安全属性', async () => {
    vi.mocked(getPublicBlogLinks).mockRejectedValueOnce(new Error('离线')).mockResolvedValueOnce({ items: [item], total: 2 }).mockResolvedValueOnce({ items: [{ ...item, id: 'link-2', name: '第二项' }], total: 2 })
    render(<BlogLinks />)
    expect(await screen.findByRole('alert')).toHaveTextContent('链接暂时未能加载')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    const link = await screen.findByRole('link', { name: /推荐网站/ })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    fireEvent.click(screen.getByRole('button', { name: '查看更多链接' }))
    expect(await screen.findByRole('link', { name: /第二项/ })).toBeInTheDocument()
    expect(getPublicBlogLinks).toHaveBeenLastCalledWith(1, expect.any(AbortSignal))
    expect(screen.queryByRole('button', { name: '查看更多链接' })).not.toBeInTheDocument()
  })

  it('没有公开链接时不留下空标题', async () => {
    vi.mocked(getPublicBlogLinks).mockResolvedValue({ items: [], total: 0 })
    const view = render(<BlogLinks />)
    await waitFor(() => expect(view.container).toBeEmptyDOMElement())
  })
})
