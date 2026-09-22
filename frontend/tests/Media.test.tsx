import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCanvas } from '../src/pages/media/useCanvas'
import { ProjectCanvas } from '../src/pages/media/ProjectCanvas'
import { AssetLibrary } from '../src/pages/media/AssetLibrary'
import { emptyDocument, type Document, MediaError } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'

const note = { id: 'b3e3d0d5-2494-47e0-9fb9-e661a1384cb0', type: 'note' as const, asset_id: null, text: '镜头一', x: 10, y: 20, width: 250, height: 180 }

describe('作品画布', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
  it('保存布局与视口，并支持撤销重做', async () => {
    const request = vi.spyOn(media, 'api').mockResolvedValue({ version: 0, document: emptyDocument() })
    const { result } = renderHook(() => useCanvas('project', 'user'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    const document: Document = { nodes: [note], viewport: { x: 30, y: 40, zoom: .5 } }
    act(() => result.current.apply(document))
    act(() => result.current.undo())
    expect(result.current.document.nodes).toHaveLength(0)
    act(() => result.current.redo())
    expect(result.current.document).toEqual(document)
    request.mockResolvedValue({ version: 1, document })
    await act(async () => { await result.current.save() })
    expect(request).toHaveBeenLastCalledWith('/projects/project/canvas', 'PUT', { version: 0, document })
    expect(result.current.status).toBe('已保存')
    expect(localStorage.getItem('genesis-media-draft:user:project')).toBeNull()
  })
  it('失败保留草稿；重新打开后恢复且不覆盖其他账户', async () => {
    const request = vi.spyOn(media, 'api').mockResolvedValue({ version: 0, document: emptyDocument() })
    const first = renderHook(() => useCanvas('project', 'user'))
    await waitFor(() => expect(first.result.current.ready).toBe(true))
    act(() => first.result.current.apply({ nodes: [note], viewport: { x: 0, y: 0, zoom: 1 } }))
    request.mockRejectedValue(new Error('离线'))
    await act(async () => { await first.result.current.save().catch(() => undefined) })
    expect(first.result.current.status).toContain('保存失败')
    first.unmount()
    request.mockResolvedValue({ version: 0, document: emptyDocument() })
    const restored = renderHook(() => useCanvas('project', 'user'))
    await waitFor(() => expect(restored.result.current.ready).toBe(true))
    expect(restored.result.current.document.nodes[0]?.text).toBe('镜头一')
    const other = renderHook(() => useCanvas('project', 'other'))
    await waitFor(() => expect(other.result.current.ready).toBe(true))
    expect(other.result.current.document.nodes).toHaveLength(0)
  })
  it('保存期间继续编辑时串行提交最新内容，不丢失修改', async () => {
    const request = vi.spyOn(media, 'api').mockResolvedValue({ version: 0, document: emptyDocument() })
    const { result } = renderHook(() => useCanvas('project', 'user'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    const first: Document = { nodes: [note], viewport: { x: 0, y: 0, zoom: 1 } }
    const latest: Document = { ...first, nodes: [{ ...note, text: '保存期间的新内容' }] }
    let release!: (value: media.Snapshot) => void
    request.mockImplementationOnce(() => new Promise<media.Snapshot>((resolve) => { release = resolve }))
    request.mockResolvedValue({ version: 2, document: latest })
    act(() => result.current.apply(first))
    let saving!: Promise<void>
    act(() => { saving = result.current.save() })
    act(() => result.current.apply(latest))
    await act(async () => {
      const followUp = result.current.save()
      const duplicate = result.current.save()
      release({ version: 1, document: first })
      await Promise.all([saving, followUp, duplicate])
    })
    expect(request).toHaveBeenCalledTimes(3)
    expect(request).toHaveBeenLastCalledWith('/projects/project/canvas', 'PUT', { version: 1, document: latest })
    expect(result.current.status).toBe('已保存')
  })
  it('409 冲突停止自动覆盖并允许重新加载', async () => {
    const request = vi.spyOn(media, 'api').mockResolvedValue({ version: 0, document: emptyDocument() })
    const { result } = renderHook(() => useCanvas('project', 'user'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.apply({ nodes: [note], viewport: { x: 0, y: 0, zoom: 1 } }))
    request.mockRejectedValue(new MediaError(409, '冲突'))
    await act(async () => { await result.current.save().catch(() => undefined) })
    expect(result.current.conflict).toBe(true)
    const calls = request.mock.calls.length
    await act(async () => { await result.current.save().catch(() => undefined) })
    expect(request).toHaveBeenCalledTimes(calls)
    request.mockResolvedValue({ version: 2, document: emptyDocument() })
    await act(async () => { await result.current.load() })
    expect(result.current.conflict).toBe(false)
    expect(result.current.document.nodes).toHaveLength(0)
  })
  it('全屏画布添加便签、缩放和抽屉交互', async () => {
    vi.spyOn(media, 'api').mockImplementation((path) => Promise.resolve(path.endsWith('/canvas') ? { version: 0, document: emptyDocument() } : path.includes('/assets') ? { items: [], total: 0 } : { id: 'project', name: '测试作品', version: 0 }))
    render(<MemoryRouter><ProjectCanvas projectId="project" userId="user" /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: '便签 ＋' })).toBeEnabled())
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '便签 ＋' }))
    fireEvent.change(screen.getByRole('textbox', { name: '便签内容' }), { target: { value: '开场镜头' } })
    expect(screen.getByRole('textbox', { name: '便签内容' })).toHaveValue('开场镜头')
    fireEvent.click(screen.getByRole('button', { name: '放大画布' }))
    expect(screen.getByRole('status', { name: '当前缩放比例' })).toHaveTextContent('120%')
    fireEvent.click(screen.getByRole('button', { name: '素材' }))
    expect(await screen.findByRole('dialog', { name: '素材库' })).toBeInTheDocument()
    expect(await screen.findByText('素材库还是空的')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭素材库' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('上传失败显示原因并可在原作品内重试', async () => {
    vi.spyOn(media, 'api').mockResolvedValue({ items: [], total: 0 })
    const uploader = vi.spyOn(media, 'upload').mockRejectedValueOnce(new Error('上传连接中断')).mockResolvedValue({ id: 'asset', name: 'test.png', kind: 'image', mime_type: 'image/png', size: 4, in_library: false })
    const { container } = render(<AssetLibrary projectId="project" onClose={() => undefined} />)
    await screen.findByText('素材库还是空的')
    const file = new File(['data'], 'test.png', { type: 'image/png' })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('上传连接中断')
    fireEvent.click(screen.getByRole('button', { name: '重试上传' }))
    await waitFor(() => expect(uploader).toHaveBeenCalledTimes(2))
    expect(uploader).toHaveBeenLastCalledWith('/projects/project/assets', file, expect.any(Function))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
  it('素材库搜索和类型筛选传递到服务端', async () => {
    const request = vi.spyOn(media, 'api').mockResolvedValue({ items: [], total: 0 })
    render(<AssetLibrary onClose={() => undefined} />)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索素材' }), { target: { value: '雨' } })
    fireEvent.change(screen.getByRole('combobox', { name: '素材类型' }), { target: { value: 'video' } })
    await screen.findByText('没有匹配的素材')
    expect(request).toHaveBeenCalledWith('/assets?q=%E9%9B%A8&page=1&kind=video')
  })
})
