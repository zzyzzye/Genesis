import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCanvas } from '../src/pages/media/useCanvas'
import { ProjectCanvas } from '../src/pages/media/ProjectCanvas'
import { MediaAssistant } from '../src/pages/media/MediaAssistant'
import { AssetLibrary } from '../src/pages/media/AssetLibrary'
import { emptyDocument, type Document, MediaError } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'
import * as ai from '../src/lib/api'
import { groupSelection, removeSelection, resizedNodeDimensions, ungroupSelection } from '../src/pages/media/canvasOperations'

const note = { id: 'b3e3d0d5-2494-47e0-9fb9-e661a1384cb0', type: 'note' as const, asset_id: null, text: '镜头一', x: 10, y: 20, width: 250, height: 180 }

describe('作品画布', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
  it('编组、取消编组和删除成员会维护画布关系', () => {
    const second = { ...note, id: crypto.randomUUID(), x: 320 }
    const third = { ...note, id: crypto.randomUUID(), x: 640 }
    const document: Document = { ...emptyDocument(), nodes: [note, second, third], edges: [{ id: crypto.randomUUID(), source: note.id, target: second.id }] }
    const grouped = groupSelection(document, [note.id, second.id])!
    expect(grouped.document.nodes[0]).toMatchObject({ type: 'group', member_ids: [note.id, second.id] })
    expect(groupSelection(grouped.document, [note.id, third.id])).toBeNull()
    expect(ungroupSelection(grouped.document, [grouped.groupId]).nodes).toEqual(document.nodes)
    const removed = removeSelection(grouped.document, [note.id], [])
    expect(removed.nodes.some((node) => node.type === 'group')).toBe(false)
    expect(removed.edges).toEqual([])
  })
  it('视频节点缩放按画布比例计算并始终保持有效尺寸', () => {
    expect(resizedNodeDimensions(820, 670, 80, 55, .8, 420, 470)).toEqual({ width: 920, height: 738.75 })
    expect(resizedNodeDimensions(820, 670, -2000, -2000, .8, 420, 470)).toEqual({ width: 420, height: 470 })
    expect(resizedNodeDimensions(240, 150, -2000, -2000, 2, 100, 80)).toEqual({ width: 100, height: 80 })
  })
  it('旧画布没有连线字段时仍可打开', async () => {
    vi.spyOn(media, 'api').mockResolvedValue({ version: 1, document: { nodes: [note], viewport: { x: 0, y: 0, zoom: 1 } } })
    const { result } = renderHook(() => useCanvas('legacy', 'user'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.document.edges).toEqual([])
    expect(result.current.document.frame).toEqual({ width: 1920, height: 1080 })
  })
  it('空旧形状可原位改成视频节点，保留节点标识与连接', async () => {
    vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1 })
    const shape = { ...note, type: 'shape' as const, text: '' }
    const other = { ...note, id: crypto.randomUUID(), x: 400 }
    const edge = { id: crypto.randomUUID(), source: shape.id, target: other.id }
    const document: Document = { ...emptyDocument(), nodes: [shape, other], edges: [edge] }
    vi.spyOn(media, 'api').mockImplementation((path) => Promise.resolve(path.endsWith('/canvas') ? { version: 0, document } : path.includes('/assets') ? { items: [], total: 0 } : { id: 'project', name: '测试作品', version: 0 }))
    render(<MemoryRouter><ProjectCanvas projectId="project" userId="user" /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: '改为视频节点' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '改为视频节点' }))
    expect(screen.getByRole('textbox', { name: '镜头描述' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '改为视频节点' })).not.toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('genesis-media-draft:user:project')!) as { document: Document }
    expect(saved.document.nodes.find((node) => node.id === shape.id)).toMatchObject({ type: 'video', x: shape.x, y: shape.y, width: 820, height: 670 })
    expect(saved.document.edges).toEqual([edge])
  })
  it('保存布局与视口，并支持撤销重做', async () => {
    const request = vi.spyOn(media, 'api').mockResolvedValue({ version: 0, document: emptyDocument() })
    const { result } = renderHook(() => useCanvas('project', 'user'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    const document: Document = { ...emptyDocument(), nodes: [note], viewport: { x: 30, y: 40, zoom: .5 } }
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
    act(() => first.result.current.apply({ ...emptyDocument(), nodes: [note] }))
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
    const first: Document = { ...emptyDocument(), nodes: [note] }
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
    act(() => result.current.apply({ ...emptyDocument(), nodes: [note] }))
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
  it('全屏画布支持便签、文字、形状和缩放，并从素材入口打开独立页面', async () => {
    vi.spyOn(media, 'api').mockImplementation((path) => Promise.resolve(path.endsWith('/canvas') ? { version: 0, document: emptyDocument() } : path.includes('/assets') ? { items: [], total: 0 } : { id: 'project', name: '测试作品', version: 0 }))
    render(<MemoryRouter initialEntries={['/media/projects/project/canvas']}><Routes>
      <Route path="/media/projects/:projectId/canvas" element={<ProjectCanvas projectId="project" userId="user" />} />
      <Route path="/media/projects/:projectId/assets" element={<p>独立的作品素材库页面</p>} />
    </Routes></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByRole('button', { name: '＋ 添加节点' })[0]).toBeEnabled())
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '＋ 添加节点' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: '便签' }))
    fireEvent.change(screen.getByRole('textbox', { name: '便签内容' }), { target: { value: '开场镜头' } })
    expect(screen.getByRole('textbox', { name: '便签内容' })).toHaveValue('开场镜头')
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加节点' }))
    fireEvent.click(screen.getByRole('button', { name: '文本' }))
    fireEvent.change(screen.getByRole('textbox', { name: '文字内容' }), { target: { value: '标题' } })
    expect(screen.getByRole('textbox', { name: '文字内容' })).toHaveValue('标题')
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加节点' }))
    fireEvent.click(screen.getByRole('button', { name: '形状' }))
    fireEvent.click(screen.getByRole('button', { name: '保留形状并编辑文字' }))
    expect(screen.getByRole('textbox', { name: '形状文字' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '形状文字' }), { target: { value: '视觉标签' } })
    fireEvent.click(screen.getByRole('button', { name: '复制节点' }))
    fireEvent.click(screen.getByRole('button', { name: '粘贴节点' }))
    expect(screen.getAllByRole('textbox', { name: '形状文字' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '切换小地图' }))
    expect(screen.getByRole('button', { name: '切换小地图' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '放大画布' }))
    expect(screen.getByRole('status', { name: '当前缩放比例' })).toHaveTextContent('120%')
    expect(screen.queryByRole('button', { name: '视频画幅设置' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '素材库' }))
    expect(await screen.findByText('独立的作品素材库页面')).toBeInTheDocument()
  })
  it('添加节点浮层可关闭、点击外部关闭，并为节点提供专用拖拽标题栏', async () => {
    vi.spyOn(media, 'api').mockImplementation((path) => Promise.resolve(path.endsWith('/canvas') ? { version: 0, document: emptyDocument() } : path.includes('/assets') ? { items: [], total: 0 } : { id: 'project', name: '测试作品', version: 0 }))
    render(<MemoryRouter><ProjectCanvas projectId="project" userId="user" /></MemoryRouter>)
    const trigger = await screen.findByRole('button', { name: '＋ 添加节点' })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '添加节点' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭节点菜单' }))
    expect(screen.queryByRole('dialog', { name: '添加节点' })).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: '添加节点' })).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '便签' }))
    expect(document.querySelector('.react-flow__node .media-node-drag-handle')).toBeInTheDocument()
    expect(document.querySelector('.react-flow__node .media-node-drag-mark')).toBeInTheDocument()
    expect(document.querySelector('.media-selection-particles')).not.toBeInTheDocument()
  })
  it('视频节点保存名称、镜头描述和时长，保留画布连接入口', async () => {
    const request = vi.spyOn(media, 'api').mockImplementation((path) => Promise.resolve(path.endsWith('/canvas') ? { version: 0, document: emptyDocument() } : path.includes('/assets') ? { items: [], total: 0 } : { id: 'project', name: '测试作品', version: 0 }))
    render(<MemoryRouter><ProjectCanvas projectId="project" userId="user" /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: '＋ 添加视频节点' }))
    expect(screen.getByLabelText('连接上一个视频节点')).toBeInTheDocument()
    expect(screen.getByLabelText('连接下一个视频节点')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '视频节点名称' }), { target: { value: '开场镜头' } })
    fireEvent.change(screen.getByRole('textbox', { name: '镜头描述' }), { target: { value: '雨夜街道，缓慢推进' } })
    fireEvent.click(screen.getByRole('button', { name: '特效' }))
    expect(screen.getByRole('textbox', { name: '镜头描述' })).toHaveValue('雨夜街道，缓慢推进 【特效】')
    fireEvent.change(screen.getByRole('combobox', { name: '镜头时长' }), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: '作品菜单' }))
    fireEvent.click(screen.getByRole('button', { name: '立即保存 / 重试' }))
    await waitFor(() => {
      const saved = request.mock.calls.find(([path, method]) => path === '/projects/project/canvas' && method === 'PUT')
      expect(saved?.[2]).toMatchObject({ document: { nodes: [{ type: 'video', name: '开场镜头', text: '雨夜街道，缓慢推进 【特效】', duration_seconds: 10 }] } })
    })
    fireEvent.click(screen.getByLabelText('连接下一个视频节点'))
    expect(screen.getAllByRole('textbox', { name: '视频节点名称' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '立即保存 / 重试' }))
    await waitFor(() => expect(request.mock.calls.some(([path, method, body]) => {
      if (path !== '/projects/project/canvas' || method !== 'PUT') return false
      const document = (body as { document: Document }).document
      return document.nodes.length === 2 && document.edges.length === 1 && document.edges[0]?.source === document.nodes[0]?.id && document.edges[0]?.target === document.nodes[1]?.id
    })).toBe(true))
  })
  it('视频节点可直接上传预览素材，失败后重试原文件', async () => {
    vi.spyOn(media, 'api').mockImplementation((path) => Promise.resolve(path.endsWith('/canvas') ? { version: 0, document: emptyDocument() } : path.includes('/assets') ? { items: [], total: 0 } : { id: 'project', name: '测试作品', version: 0 }))
    const assetId = crypto.randomUUID()
    const uploader = vi.spyOn(media, 'upload').mockRejectedValueOnce(new Error('连接中断')).mockResolvedValue({ id: assetId, name: 'frame.png', kind: 'image', mime_type: 'image/png', size: 4, in_library: false })
    render(<MemoryRouter><ProjectCanvas projectId="project" userId="user" /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: '＋ 添加视频节点' }))
    const file = new File(['data'], 'frame.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('导入视频节点预览素材'), { target: { files: [file] } })
    expect(await screen.findByRole('button', { name: '重试上传' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试上传' }))
    await waitFor(() => expect(uploader).toHaveBeenCalledTimes(2))
    expect(uploader).toHaveBeenLastCalledWith('/projects/project/assets', file, expect.any(Function))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '视频节点预览素材' })).toHaveValue(assetId))
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
  it('助手会把当前选中节点作为可移除的讨论上下文', () => {
    render(<MediaAssistant token={null} page="canvas" projectId="project" selectedNode={{ id: 'node-1', type: 'note', name: '', text: '雨夜开场', assetId: null }} />)
    fireEvent.click(screen.getByRole('button', { name: '镜头搭档' }))
    expect(screen.getByText('正在讨论 · 雨夜开场')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '移除当前讨论节点' }))
    expect(screen.queryByText('正在讨论 · 雨夜开场')).not.toBeInTheDocument()
  })
  it('助手模型菜单使用供应商标签与统一模型项，并支持点击外部关闭', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      provider: 'openai',
      models: [{ id: 'gpt-6-sol', name: 'gpt-6-sol', created: null, context_window: 1050000 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    render(<MediaAssistant token="test-token" page="canvas" projectId="project" selectedNode={null} />)
    fireEvent.click(screen.getByRole('button', { name: '镜头搭档' }))
    const trigger = screen.getByRole('button', { name: '选择模型' })
    await waitFor(() => expect(trigger).toHaveTextContent('OpenAI'))
    fireEvent.click(trigger)
    expect(await screen.findByRole('button', { name: '切换到 OpenAI 模型' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /gpt-6-sol\s*1.05M/ })).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('textbox', { name: '向镜头搭档提问' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
  it('Enter 发送并将用户和助手消息作为 Markdown 展示', async () => {
    vi.spyOn(ai, 'getProviderModels').mockResolvedValue({ provider: 'openai', models: [] })
    const chat = vi.spyOn(ai, 'streamAiChat').mockImplementation((_token, _request, onChunk) => { onChunk('**助手标记**'); return Promise.resolve() })
    render(<MediaAssistant token="test-token" page="canvas" projectId="project" selectedNode={null} />)
    fireEvent.click(screen.getByRole('button', { name: '镜头搭档' }))
    const input = screen.getByRole('textbox', { name: '向镜头搭档提问' })
    fireEvent.change(input, { target: { value: '**用户标记**' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('用户标记', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('助手标记', { selector: 'strong' })).toBeInTheDocument()
  })
})
