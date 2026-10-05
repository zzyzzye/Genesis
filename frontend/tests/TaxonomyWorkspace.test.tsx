import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaxonomyWorkspace } from '../src/studio/TaxonomyWorkspace'
import { createAdminBlogCategory, createAdminBlogTag, deleteAdminBlogTaxonomy, updateAdminBlogTaxonomy } from '../src/lib/api'

vi.mock('../src/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  createAdminBlogCategory: vi.fn(),
  createAdminBlogTag: vi.fn(),
  updateAdminBlogTaxonomy: vi.fn(),
  deleteAdminBlogTaxonomy: vi.fn(),
}))

const item = { id: 'category-1', name: '工程实践', slug: 'engineering' }
function mount(usage: Record<string, number> = {}, route = '/studio/blog/categories') {
  const onChanged = vi.fn()
  render(<MemoryRouter initialEntries={[route]}><TaxonomyWorkspace kind="categories" items={[item]} usage={usage} token="test-placeholder" onChanged={onChanged} /></MemoryRouter>)
  return onChanged
}

describe('分类管理交互', () => {
  afterEach(() => { cleanup(); vi.resetAllMocks() })

  it('标签只填名称即可创建，支持中文、大小写和符号；改名保持关联标识', async () => {
    const onChanged = vi.fn()
    render(<MemoryRouter><TaxonomyWorkspace kind="tags" items={[item]} usage={{ [item.id]: 1 }} token="test-placeholder" onChanged={onChanged} /></MemoryRouter>)
    expect(screen.queryByLabelText('标识（Slug）')).not.toBeInTheDocument()
    const name = 'Agent / 中文 + 🚀'
    vi.mocked(createAdminBlogTag).mockImplementation((_, data) => Promise.resolve({ id: 'tag-new', ...data }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: name } })
    fireEvent.click(screen.getByRole('button', { name: '创建标签' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(vi.mocked(createAdminBlogTag).mock.calls[0]?.[1].name).toBe(name)
    expect(vi.mocked(createAdminBlogTag).mock.calls[0]?.[1].slug).toMatch(/^tag-[a-f0-9-]+$/)
    fireEvent.click(screen.getByRole('button', { name: '编辑标签：工程实践' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: name } })
    vi.mocked(updateAdminBlogTaxonomy).mockResolvedValue({ ...item, name })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => expect(updateAdminBlogTaxonomy).toHaveBeenCalledWith('test-placeholder', 'tags', item.id, { name, slug: item.slug }))
  })

  it('失败保留输入，重试成功回传数据，处理中阻止重复提交', async () => {
    const onChanged = mount()
    vi.mocked(createAdminBlogCategory).mockRejectedValueOnce(new Error('名称已存在'))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: ' 新分类 ' } })
    fireEvent.change(screen.getByLabelText('标识（Slug）'), { target: { value: 'new-category' } })
    fireEvent.click(screen.getByRole('button', { name: '创建分类' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('名称已存在')
    expect(screen.getByLabelText('名称')).toHaveValue(' 新分类 ')
    let complete!: (value: typeof item) => void
    vi.mocked(createAdminBlogCategory).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '创建分类' }))
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled()
    complete({ ...item, name: '新分类', slug: 'new-category' })
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ ...item, name: '新分类', slug: 'new-category' }, null))
    expect(createAdminBlogCategory).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('名称')).toHaveValue('')
  })

  it('使用中的分类仍可编辑，不能删除', async () => {
    const onChanged = mount({ [item.id]: 2 })
    expect(screen.getByRole('button', { name: '删除分类：工程实践' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '编辑分类：工程实践' }))
    fireEvent.change(screen.getByLabelText('标识（Slug）'), { target: { value: 'renamed' } })
    vi.mocked(updateAdminBlogTaxonomy).mockResolvedValue({ ...item, slug: 'renamed' })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ ...item, slug: 'renamed' }, item))
    expect(updateAdminBlogTaxonomy).toHaveBeenCalledWith('test-placeholder', 'categories', item.id, { name: item.name, slug: 'renamed' })
  })

  it('删除默认聚焦取消，Escape 返回触发按钮，确认后调用接口', async () => {
    const onChanged = mount()
    const trigger = screen.getByRole('button', { name: '删除分类：工程实践' })
    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: '取消' }), { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(deleteAdminBlogTaxonomy).not.toHaveBeenCalled()
    fireEvent.click(trigger)
    vi.mocked(deleteAdminBlogTaxonomy).mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null, item))
  })

  it('读取 URL 搜索，清空后恢复列表；非法标识不提交', () => {
    mount({}, '/studio/blog/categories?q=不存在')
    expect(screen.getByText('没有匹配的结果')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清空分类搜索' }))
    expect(screen.getByText('工程实践')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '分类' } })
    fireEvent.change(screen.getByLabelText('标识（Slug）'), { target: { value: '无效标识' } })
    fireEvent.click(screen.getByRole('button', { name: '创建分类' }))
    expect(screen.getByRole('alert')).toHaveTextContent('标识使用小写字母')
    expect(screen.getByLabelText('标识（Slug）')).toHaveFocus()
    expect(createAdminBlogCategory).not.toHaveBeenCalled()
  })
})
