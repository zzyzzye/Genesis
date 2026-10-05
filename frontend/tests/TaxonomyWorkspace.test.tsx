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

const item = { id: 'taxonomy-1', name: '工程实践', slug: 'engineering' }
const other = { id: 'taxonomy-2', name: '产品', slug: 'product' }
// jsdom 不实现滚动，由浏览器自检验证实际定位。
Element.prototype.scrollIntoView = vi.fn()
function mount(kind: 'categories' | 'tags', usage: Record<string, number> = {}, query = '') {
  const onChanged = vi.fn()
  const view = render(<MemoryRouter initialEntries={['/studio/blog/' + kind + query]}><TaxonomyWorkspace kind={kind} items={[item, other]} usage={usage} token="test-placeholder" onChanged={onChanged} /></MemoryRouter>)
  return { onChanged, ...view }
}

describe.each(['categories', 'tags'] as const)('%s 管理交互', (kind) => {
  const label = kind === 'categories' ? '分类' : '标签'
  const createApi = kind === 'categories' ? createAdminBlogCategory : createAdminBlogTag
  afterEach(() => { cleanup(); vi.resetAllMocks() })

  it('只填名称即可添加，成功后清空输入；失败保留名称且阻止重复提交', async () => {
    const { onChanged, container } = mount(kind)
    expect(screen.queryByLabelText('标识（Slug）')).not.toBeInTheDocument()
    vi.mocked(createApi).mockRejectedValueOnce(new Error('网络暂时不可用'))
    const name = 'Agent / 中文 + 🚀'
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: ' ' + name + ' ' } })
    fireEvent.submit(container.querySelector('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('网络暂时不可用')
    expect(screen.getByLabelText('名称')).toHaveValue(' ' + name + ' ')
    let complete!: (value: typeof item) => void
    vi.mocked(createApi).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    fireEvent.submit(container.querySelector('form')!)
    expect(screen.getByRole('button', { name: '添加中…' })).toBeDisabled()
    const submitted = vi.mocked(createApi).mock.calls[1]![1]
    expect(submitted.name).toBe(name)
    expect(submitted.slug).toMatch(kind === 'tags' ? /^tag-[a-f0-9-]+$/ : /^category-[a-f0-9-]+$/)
    complete({ ...item, id: 'new-id', ...submitted })
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ ...item, id: 'new-id', ...submitted }, null))
    expect(createApi).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('名称')).toHaveValue('')
    await waitFor(() => expect(screen.getByLabelText('名称')).toHaveFocus())
  })

  it('添加已有名称时清空搜索并定位已有项，不发重复请求', async () => {
    mount(kind, {}, '?q=不存在')
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: ' 工程实践 ' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(screen.getByRole('status')).toHaveTextContent('已存在，已为你定位')
    expect(screen.getByLabelText('搜索' + label)).toHaveValue('')
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑' + label + '：工程实践' })).toHaveFocus())
    expect(createApi).not.toHaveBeenCalled()
  })

  it('行内改名保留标识和关联，Enter 保存，输入法确认不触发保存', async () => {
    const { onChanged } = mount(kind, { [item.id]: 2 })
    expect(screen.getByRole('button', { name: '删除' + label + '：工程实践' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '编辑' + label + '：工程实践' }))
    const input = screen.getByLabelText('修改' + label + '名称')
    expect(input).toHaveFocus()
    expect(screen.getByLabelText('名称')).toBeDisabled()
    fireEvent.change(input, { target: { value: ' 新名称 + 中文 ' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(updateAdminBlogTaxonomy).not.toHaveBeenCalled()
    vi.mocked(updateAdminBlogTaxonomy).mockResolvedValue({ ...item, name: '新名称 + 中文' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ ...item, name: '新名称 + 中文' }, item))
    expect(updateAdminBlogTaxonomy).toHaveBeenCalledWith('test-placeholder', kind, item.id, { name: '新名称 + 中文', slug: item.slug })
    expect(screen.queryByLabelText('修改' + label + '名称')).not.toBeInTheDocument()
  })

  it('Esc 取消草稿并恢复焦点；不改名称时无需请求', async () => {
    mount(kind)
    const trigger = screen.getByRole('button', { name: '编辑' + label + '：工程实践' })
    fireEvent.click(trigger)
    fireEvent.change(screen.getByLabelText('修改' + label + '名称'), { target: { value: '未保存草稿' } })
    fireEvent.keyDown(screen.getByLabelText('修改' + label + '名称'), { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑' + label + '：工程实践' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: '编辑' + label + '：工程实践' }))
    expect(screen.getByLabelText('修改' + label + '名称')).toHaveValue(item.name)
    fireEvent.keyDown(screen.getByLabelText('修改' + label + '名称'), { key: 'Enter' })
    expect(updateAdminBlogTaxonomy).not.toHaveBeenCalled()
  })

  it('行内校验重名，保存失败保留草稿，可重试', async () => {
    mount(kind)
    fireEvent.click(screen.getByRole('button', { name: '编辑' + label + '：工程实践' }))
    const input = screen.getByLabelText('修改' + label + '名称')
    fireEvent.change(input, { target: { value: other.name } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByRole('alert')).toHaveTextContent('这个名称已存在')
    expect(updateAdminBlogTaxonomy).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '改名草稿' } })
    vi.mocked(updateAdminBlogTaxonomy).mockRejectedValueOnce(new Error('保存失败'))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
    expect(input).toHaveValue('改名草稿')
    vi.mocked(updateAdminBlogTaxonomy).mockResolvedValue({ ...item, name: '改名草稿' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByLabelText('修改' + label + '名称')).not.toBeInTheDocument())
  })

  it('空名称聚焦输入，输入法 Enter 不提交，搜索可清空', () => {
    const { container } = mount(kind, {}, '?q=不存在')
    expect(screen.getByText('没有匹配的结果')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清空' + label + '搜索' }))
    expect(screen.getByRole('button', { name: '编辑' + label + '：工程实践' })).toBeInTheDocument()
    fireEvent.submit(container.querySelector('form')!)
    expect(screen.getByRole('alert')).toHaveTextContent('请输入名称')
    expect(screen.getByLabelText('名称')).toHaveFocus()
    expect(fireEvent.keyDown(screen.getByLabelText('名称'), { key: 'Enter', isComposing: true })).toBe(false)
    expect(createApi).not.toHaveBeenCalled()
  })

  it('删除确认紧邻当前行，默认聚焦取消；失败保留确认，成功回传数据', async () => {
    const { onChanged } = mount(kind)
    const trigger = screen.getByRole('button', { name: '删除' + label + '：工程实践' })
    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: '取消' }), { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(deleteAdminBlogTaxonomy).not.toHaveBeenCalled()
    fireEvent.click(trigger)
    vi.mocked(deleteAdminBlogTaxonomy).mockRejectedValueOnce(new Error('删除失败'))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('删除失败')
    vi.mocked(deleteAdminBlogTaxonomy).mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null, item))
  })
})
