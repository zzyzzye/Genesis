import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaxonomyPicker } from '../src/studio/TaxonomyPicker'
import type { BlogTag } from '../src/lib/api'

const options = [{ id: 'one', name: '工程', slug: 'engineering' }, { id: 'two', name: '产品', slug: 'product' }]
const create = vi.fn<(name: string) => Promise<BlogTag>>()
function Harness({ kind = 'tags', initialItems = options, initialSelected = [] }: { kind?: 'categories' | 'tags'; initialItems?: BlogTag[]; initialSelected?: string[] }) {
  const [items, setItems] = useState(initialItems)
  const [selected, setSelected] = useState(initialSelected)
  return <TaxonomyPicker kind={kind} items={items} selected={selected} onSelect={(item) => setSelected((current) => kind === 'categories' ? item ? [item.id] : [] : item ? current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id] : current)} onCreate={(name) => create(name).then((saved) => { setItems((current) => [...current, saved]); setSelected((current) => kind === 'categories' ? [saved.id] : [...current, saved.id]); return saved })} />
}

describe('文章内分类与标签选择', () => {
  afterEach(() => { cleanup(); vi.resetAllMocks() })

  it('点击标签即可选择或移除，搜索已有名称 Enter 选择，不调用创建', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '工程' }))
    expect(screen.getByRole('button', { name: '移除标签 工程' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '移除标签 工程' }))
    expect(screen.queryByRole('button', { name: '移除标签 工程' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('搜索或新建标签'), { target: { value: '产品' } })
    fireEvent.keyDown(screen.getByLabelText('搜索或新建标签'), { key: 'Enter' })
    expect(screen.getByRole('button', { name: '移除标签 产品' })).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('分类保持单选，可直接切换和清空', () => {
    render(<Harness kind="categories" />)
    fireEvent.click(screen.getByRole('button', { name: '工程' }))
    fireEvent.click(screen.getByRole('button', { name: '产品' }))
    expect(screen.queryByRole('button', { name: '移除分类 工程' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移除分类 产品' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '暂不分类' }))
    expect(screen.queryByRole('button', { name: '移除分类 产品' })).not.toBeInTheDocument()
  })

  it('新名称创建后自动选中；输入法 Enter 不提交，失败保留输入并可重试', async () => {
    render(<Harness />)
    const input = screen.getByLabelText('搜索或新建标签')
    fireEvent.change(input, { target: { value: 'AI + 中文' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(create).not.toHaveBeenCalled()
    create.mockRejectedValueOnce(new Error('网络不可用'))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('网络不可用')
    expect(input).toHaveValue('AI + 中文')
    let complete!: (value: BlogTag) => void
    create.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('button', { name: '创建中…' })).toBeDisabled()
    complete({ id: 'new', name: 'AI + 中文', slug: 'tag-new' })
    expect(await screen.findByRole('button', { name: '移除标签 AI + 中文' })).toBeInTheDocument()
    expect(create).toHaveBeenCalledTimes(2)
    expect(input).toHaveValue('')
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('达到十个标签时可移除，但不允许再选或创建', () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ id: String(i), name: '标签 ' + i, slug: 'tag-' + i }))
    render(<Harness initialItems={items} initialSelected={items.slice(0, 10).map((item) => item.id)} />)
    expect(screen.getByRole('button', { name: '标签 10' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('搜索或新建标签'), { target: { value: '新标签' } })
    expect(screen.getByRole('button', { name: '创建「新标签」' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '移除标签 标签 0' }))
    expect(screen.getByRole('button', { name: '标签 10' })).toBeEnabled()
    expect(create).not.toHaveBeenCalled()
  })
})
