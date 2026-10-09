import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaxonomyWorkspace } from '../src/studio/TaxonomyWorkspace'
import { createAdminBlogCategory, createAdminBlogTag, deleteAdminBlogTaxonomy, updateAdminBlogTaxonomy } from '../src/lib/api'

vi.mock('../src/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  createAdminBlogCategory: vi.fn(), createAdminBlogTag: vi.fn(),
  updateAdminBlogTaxonomy: vi.fn(), deleteAdminBlogTaxonomy: vi.fn(),
}))
const item = { id: 'taxonomy-1', name: '工程实践', slug: 'engineering' }
const other = { id: 'taxonomy-2', name: '产品', slug: 'product' }

describe.each(['categories', 'tags'] as const)('%s 管理', (kind) => {
  const label = kind === 'tags' ? '标签' : '分类'
  const createApi = kind === 'tags' ? createAdminBlogTag : createAdminBlogCategory
  function mount(usage: Record<string, number> = {}, query = '') {
    const onChanged = vi.fn()
    const view = render(<MemoryRouter initialEntries={['/blog/studio/' + kind + query]}><TaxonomyWorkspace kind={kind} items={[item, other]} usage={usage} token="test-placeholder" onChanged={onChanged} /></MemoryRouter>)
    return { onChanged, ...view }
  }
  afterEach(() => { cleanup(); vi.resetAllMocks() })

  it('搜索与创建共用输入；失败保留名称，重试成功，禁止重复提交', async () => {
    const { onChanged, container } = mount()
    const input = screen.getByLabelText('搜索或新建' + label)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    vi.mocked(createApi).mockRejectedValueOnce(new Error('网络不可用'))
    fireEvent.change(input, { target: { value: 'Agent 中文 + 🚀' } })
    fireEvent.submit(container.querySelector('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('网络不可用')
    expect(input).toHaveValue('Agent 中文 + 🚀')
    let complete!: (value: typeof item) => void
    vi.mocked(createApi).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    fireEvent.submit(container.querySelector('form')!)
    fireEvent.submit(container.querySelector('form')!)
    expect(screen.getByRole('button', { name: '创建中…' })).toBeDisabled()
    const data = vi.mocked(createApi).mock.calls[1]![1]
    expect(data.name).toBe('Agent 中文 + 🚀')
    expect(data.slug).toMatch(kind === 'tags' ? /^tag-[a-f0-9-]+$/ : /^category-[a-f0-9-]+$/)
    complete({ ...item, ...data })
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ ...item, ...data }, null))
    expect(createApi).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(input).toHaveValue(''))
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('已有名称定位原项，不创建重复项；搜索可清空', async () => {
    mount({}, '?q=不存在')
    expect(screen.getByText('还没有「不存在」')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清空' + label + '搜索' }))
    fireEvent.change(screen.getByLabelText('搜索或新建' + label), { target: { value: item.name } })
    fireEvent.click(screen.getByRole('button', { name: '定位' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑' + label + '：' + item.name })).toHaveFocus())
    expect(createApi).not.toHaveBeenCalled()
  })

  it('模态管理中改名保留关联标识，失败后可重试', async () => {
    const { onChanged } = mount({ [item.id]: 2 })
    fireEvent.click(screen.getByRole('button', { name: '编辑' + label + '：' + item.name }))
    expect(screen.getByRole('dialog', { name: '编辑' + label })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' + label })).toBeDisabled()
    const input = screen.getByLabelText('修改' + label + '名称')
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: '新的名称' } })
    vi.mocked(updateAdminBlogTaxonomy).mockRejectedValueOnce(new Error('保存失败'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
    expect(input).toHaveValue('新的名称')
    vi.mocked(updateAdminBlogTaxonomy).mockResolvedValue({ ...item, name: '新的名称' })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ ...item, name: '新的名称' }, item))
    expect(updateAdminBlogTaxonomy).toHaveBeenCalledWith('test-placeholder', kind, item.id, { name: '新的名称', slug: item.slug })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('取消管理恢复触发器焦点；重名阻止保存；输入法 Enter 不提交', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '编辑' + label + '：' + item.name }))
    const input = screen.getByLabelText('修改' + label + '名称')
    fireEvent.change(input, { target: { value: other.name } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByRole('alert')).toHaveTextContent('名称已存在')
    expect(updateAdminBlogTaxonomy).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false)
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑' + label + '：' + item.name })).toHaveFocus())
  })

  it('删除进入明确确认，默认聚焦取消，失败保留确认，成功回传', async () => {
    const { onChanged } = mount()
    fireEvent.click(screen.getByRole('button', { name: '编辑' + label + '：' + item.name }))
    fireEvent.click(screen.getByRole('button', { name: '删除' + label }))
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(screen.getByLabelText('修改' + label + '名称')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除' + label }))
    vi.mocked(deleteAdminBlogTaxonomy).mockRejectedValueOnce(new Error('删除失败'))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('删除失败')
    vi.mocked(deleteAdminBlogTaxonomy).mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null, item))
  })
})
