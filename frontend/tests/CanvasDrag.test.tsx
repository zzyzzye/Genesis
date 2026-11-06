import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactFlowProps } from '@xyflow/react'
import { emptyDocument, type Document, type Node } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'
import { applyCanvasNodeChanges, duplicateCanvasSelection } from '../src/pages/media/canvasOperations'
import { ProjectCanvas } from '../src/pages/media/ProjectCanvas'
import type { MediaCanvasActions } from '../src/pages/media/MediaAssistant'

const flow = vi.hoisted(() => ({ props: null as ReactFlowProps | null }))
vi.mock('@xyflow/react', async (original) => {
  const module = await original<typeof import('@xyflow/react')>()
  return { ...module, ReactFlow: (props: ReactFlowProps) => { flow.props = props; return <module.ReactFlow {...props} /> } }
})

const node: Node = { id: 'moving', type: 'note', name: '调度便签', asset_id: null, text: '保留正文', x: 10, y: 20, width: 280, height: 220 }
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); flow.props = null })

describe('画布拖动同步', () => {
  it('他人画布只读，允许缩放但不暴露编辑或生成入口，也不保存草稿', async () => {
    const document: Document = { ...emptyDocument(), nodes: [node] }
    const request = vi.spyOn(media, 'api').mockImplementation(path => Promise.resolve(path.endsWith('/canvas') ? { version: 0, document, read_only: true } : path.includes('/assets') ? { items: [], total: 0 } : { id: 'readonly', name: '他人作品', version: 0 }))
    render(<MemoryRouter><ProjectCanvas projectId="readonly" userId="viewer" /></MemoryRouter>)
    await screen.findByText('只读画布 · 可平移和缩放')
    expect(screen.queryByRole('textbox', { name: '便签内容' })).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: '创作工具' })).not.toBeInTheDocument()
    expect(flow.props!.nodesDraggable).toBe(false)
    expect(flow.props!.nodesConnectable).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '放大画布' }))
    expect(screen.getByLabelText('当前缩放比例')).toHaveTextContent('110%')
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(screen.getByText('保留正文')).toBeInTheDocument()
    expect(localStorage.getItem('genesis-media-draft:viewer:readonly')).toBeNull()
    expect(request.mock.calls.every(([, method]) => method === undefined)).toBe(true)
  })
  it('整组副本重映射成员、内部连线和引用，并保留外部上游', () => {
    const image: Node = { ...node, id: 'image', type: 'image' }
    const video: Node = { ...node, id: 'video', type: 'video', text: '@[图片](ref:image) @[图片](ref:outside)' }
    const outside: Node = { ...image, id: 'outside' }
    const group: Node = { ...node, id: 'group', type: 'group', member_ids: ['image', 'video'] }
    const document: Document = { ...emptyDocument(), nodes: [outside, group, image, video], edges: [
      { id: 'internal', source: 'image', target: 'video' }, { id: 'upstream', source: 'outside', target: 'video' }, { id: 'downstream', source: 'video', target: 'outside' },
    ] }
    const result = duplicateCanvasSelection(document, ['group'])
    const id = (original: string) => result.idMap.get(original)!
    expect(result.idMap.size).toBe(3)
    expect(result.document.nodes.find(item => item.id === id('group'))?.member_ids).toEqual([id('image'), id('video')])
    expect(result.document.nodes.find(item => item.id === id('video'))?.text).toBe(`@[图片](ref:${id('image')}) @[图片](ref:outside)`)
    expect(result.document.edges.slice(3)).toEqual([
      expect.objectContaining({ source: id('image'), target: id('video') }), expect.objectContaining({ source: 'outside', target: id('video') }),
    ])
  })

  it.each(['image_generation', 'video'] as const)('Alt 拖动 %s 仅移动副本，保留参考并一次撤销、保存恢复', async type => {
    vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1 })
    const source = { ...node, id: 'reference', type: 'image' as const }
    const target = { ...node, type, text: '@[图片](ref:reference)' }
    let document: Document = { ...emptyDocument(), nodes: [source, target], edges: [{ id: 'edge', source: source.id, target: target.id }] }
    vi.spyOn(media, 'api').mockImplementation((path, method, body) => {
      if (path.endsWith('/canvas')) {
        if (method === 'PUT') document = (body as { document: Document }).document
        return Promise.resolve({ version: 0, document })
      }
      return Promise.resolve(path.includes('/assets') ? { items: [], total: 0 } : { id: 'alt-drag', name: '副本拖动验收' })
    })
    let actions: MediaCanvasActions | null = null
    render(<MemoryRouter><ProjectCanvas projectId="alt-drag" userId="user" onAgentActionsChange={value => { actions = value }} /></MemoryRouter>)
    await screen.findByTestId('rf__node-moving')
    const callbacks = flow.props!
    const moving = callbacks.nodes!.find(item => item.id === target.id)!
    act(() => { callbacks.onNodeDragStart?.({ altKey: true } as MouseEvent, moving, [moving]) })
    const copy = actions!.getDocument().nodes.find(item => ![source.id, target.id].includes(item.id))!
    for (const position of [{ x: 100, y: 200 }, { x: 300, y: 400 }]) {
      act(() => { flow.props!.onNodesChange?.([{ type: 'position', id: target.id, position, dragging: true }]) })
      expect(actions!.getDocument().nodes.find(item => item.id === target.id)).toMatchObject({ x: 10, y: 20 })
      expect(screen.getByTestId(`rf__node-${copy.id}`)).toHaveStyle({ transform: `translate(${position.x}px,${position.y}px)` })
    }
    act(() => { flow.props!.onNodeDragStop?.({} as MouseEvent, moving, [moving]) })
    expect(actions!.getDocument().edges).toContainEqual(expect.objectContaining({ source: source.id, target: copy.id }))
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(actions!.getDocument().nodes).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    await act(async () => { await actions!.save() })
    expect(document.nodes.find(item => item.id === copy.id)).toMatchObject({ x: 300, y: 400, text: target.text })
    expect(document.nodes.find(item => item.id === target.id)).toMatchObject({ x: 10, y: 20 })
  })
  it('双指平移经过节点和输入区不断开；新手势在聚焦便签内滚动，失焦后恢复平移', async () => {
    vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1 })
    const document: Document = { ...emptyDocument(), viewport: { x: 0, y: 0, zoom: .53 }, nodes: [node, { ...node, id: 'image', type: 'image', name: '参考图', x: 500 }] }
    vi.spyOn(media, 'api').mockImplementation((path) => Promise.resolve(path.endsWith('/canvas') ? { version: 0, document } : path.includes('/assets') ? { items: [], total: 0 } : { id: 'wheel', name: '平移验收', version: 0 }))
    let actions: MediaCanvasActions | null = null
    render(<MemoryRouter><ProjectCanvas projectId="wheel" userId="wheel-user" onAgentActionsChange={(value) => { actions = value }} /></MemoryRouter>)
    const image = await screen.findByTestId('rf__node-image')
    expect(actions!.getDocument().viewport.zoom).toBe(1)
    const positions = document.nodes.map(({ x, y }) => [x, y])
    const preview = image.querySelector('.media-node-media-empty')!
    fireEvent.wheel(preview, { deltaX: 40, deltaY: 80, bubbles: true, cancelable: true })
    await waitFor(() => expect(actions!.getDocument().viewport).toMatchObject({ x: -20, y: -40 }))
    expect(flow.props!.nodesDraggable).toBe(false)
    const textarea = screen.getByRole('textbox', { name: '便签内容' })
    fireEvent.wheel(textarea, { deltaY: 80, bubbles: true, cancelable: true })
    await waitFor(() => expect(actions!.getDocument().viewport.y).toBe(-80))
    fireEvent.focus(textarea)
    fireEvent.wheel(textarea, { deltaY: 80, bubbles: true, cancelable: true })
    await waitFor(() => expect(actions!.getDocument().viewport.y).toBe(-120))
    await waitFor(() => expect(flow.props!.nodesDraggable).toBe(true))
    fireEvent.wheel(textarea, { deltaY: 80, bubbles: true, cancelable: true })
    expect(actions!.getDocument().viewport.y).toBe(-120)
    fireEvent.blur(textarea)
    fireEvent.wheel(textarea, { deltaY: 80, bubbles: true, cancelable: true })
    await waitFor(() => expect(actions!.getDocument().viewport.y).toBe(-160))
    // 延迟结束事件只结束手势，不能把旧坐标写回受控视口。
    act(() => flow.props!.onMoveEnd?.(null, { x: 0, y: 0, zoom: 1 }))
    expect(actions!.getDocument().viewport.y).toBe(-160)
    expect(actions!.getDocument().nodes.map(({ x, y }) => [x, y])).toEqual(positions)
    await waitFor(() => expect(flow.props!.nodesDraggable).toBe(true))
  })

  it('连续坐标更新只改动最新文档的几何信息，不回滚缩放、正文或异步新增结果', () => {
    const result: Node = { ...node, id: 'result', type: 'image', asset_id: 'image', width: 360, height: 203 }
    const current: Document = { ...emptyDocument(), nodes: [{ ...node, name: '最新名字', text: '最新正文', width: 400 }, result], edges: [{ id: 'reference', source: node.id, target: result.id }] }
    const first = applyCanvasNodeChanges(current, [{ type: 'position', id: node.id, position: { x: 40, y: 70 }, dragging: true }])
    const second = applyCanvasNodeChanges(first, [{ type: 'position', id: node.id, position: { x: 90, y: 130 }, dragging: true }])
    expect(second.nodes[0]).toEqual({ ...current.nodes[0], x: 90, y: 130 })
    expect(second.nodes[1]).toBe(result)
    expect(second.edges).toBe(current.edges)
    expect(second.viewport).toBe(current.viewport)
    expect(applyCanvasNodeChanges(second, [{ type: 'position', id: node.id, position: { x: 90, y: 130 }, dragging: false }])).toBe(second)
    expect(applyCanvasNodeChanges(second, [{ type: 'dimensions', id: node.id, dimensions: { width: 100, height: 100 } }])).toBe(second)
  })

  it('拖动分组只移动成员一次，整组多选与独立节点保持各自坐标', () => {
    const second = { ...node, id: 'second', x: 330 }
    const outside = { ...node, id: 'outside', x: 900 }
    const group: Node = { ...node, id: 'group', type: 'group', member_ids: [node.id, second.id], x: 0, y: 0 }
    const document = { ...emptyDocument(), nodes: [group, node, second, outside] }
    const moved = applyCanvasNodeChanges(document, [{ type: 'position', id: group.id, position: { x: 100, y: 50 }, dragging: true }, { type: 'position', id: node.id, position: { x: 110, y: 70 }, dragging: true }])
    expect(moved.nodes.map(({ x, y }) => [x, y])).toEqual([[100, 50], [110, 70], [430, 70], [900, 20]])
    expect(moved.nodes[3]).toBe(outside)
  })

  it('原生拖动回调在返回前渲染最新位置，一次撤销重做和保存重开保持最终落点', async () => {
    vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1 })
    let document: Document = { ...emptyDocument(), nodes: [node] }
    vi.spyOn(media, 'api').mockImplementation((path, method, body) => {
      if (path.endsWith('/canvas')) {
        if (method === 'PUT') document = (body as { document: Document }).document
        return Promise.resolve({ version: 0, document })
      }
      return Promise.resolve(path.includes('/assets') ? { items: [], total: 0 } : { id: 'drag', name: '拖动验收', version: 0 })
    })
    let actions: MediaCanvasActions | null = null
    const show = () => render(<MemoryRouter><ProjectCanvas projectId="drag" userId="drag-user" onAgentActionsChange={(value) => { actions = value }} /></MemoryRouter>)
    const view = show()
    const element = await screen.findByTestId(`rf__node-${node.id}`)
    const callbacks = flow.props!
    const source = callbacks.nodes![0]!
    act(() => { callbacks.onNodeDragStart?.({} as MouseEvent, source, [source]) })
    act(() => {
      for (const [x, y] of [[40, 70], [80, 130], [120, 180]] as const) {
        callbacks.onNodesChange?.([{ type: 'position', id: node.id, position: { x, y }, dragging: true }])
        expect(element).toHaveStyle({ transform: `translate(${x}px,${y}px)` })
      }
      callbacks.onNodesChange?.([{ type: 'position', id: node.id, position: { x: 120, y: 180 }, dragging: false }])
      callbacks.onNodeDragStop?.({} as MouseEvent, source, [source])
    })
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(element).toHaveStyle({ transform: 'translate(10px,20px)' })
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(element).toHaveStyle({ transform: 'translate(120px,180px)' })
    await act(async () => { await actions!.save() })
    expect(document.nodes[0]).toMatchObject({ x: 120, y: 180, text: '保留正文' })
    view.unmount(); show()
    await waitFor(() => expect(screen.getByTestId(`rf__node-${node.id}`)).toHaveStyle({ transform: 'translate(120px,180px)' }))
  })
})
