import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { emptyDocument, type Node } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'
import { indexCanvasReferences, createCanvasNodeReconciler } from '../src/pages/media/canvasGraph'
import { useCanvas } from '../src/pages/media/useCanvas'

const node: Node = { id: 'one', type: 'note', asset_id: null, text: '正文', x: 0, y: 0, width: 280, height: 220 }
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks() })

it('1000 节点、2000 条边只线性读取边，引用去重并保持原顺序', () => {
  const nodes = Array.from({ length: 1000 }, (_, index) => ({ ...node, id: String(index) }))
  const readSource = vi.fn((index: number) => String(index % 999))
  const edges = Array.from({ length: 2000 }, (_, index) => ({ id: String(index), get source() { return readSource(index) }, target: '999' }))
  const result = indexCanvasReferences(nodes, edges, {})
  expect(result.references.get('999')?.map(entry => entry.node.id)).toEqual(nodes.slice(0, 999).map(entry => entry.id))
  expect(readSource.mock.calls.length).toBeLessThanOrEqual(4000)
})

it('移动单个节点只替换对应对象，未改动节点和 data 保持引用', () => {
  const reconcile = createCanvasNodeReconciler()
  const nodes = Array.from({ length: 1000 }, (_, index) => ({ ...node, id: String(index) }))
  const build = () => nodes.map(source => ({ id: source.id, type: source.type, position: { x: source.x, y: source.y }, measured: { width: source.width, height: source.height }, handles: [], data: { source, references: [], referenceCandidates: [] } }))
  const before = reconcile(build())
  nodes[25] = { ...nodes[25]!, x: 100 }
  const after = reconcile(build())
  expect(after.filter((entry, index) => entry !== before[index])).toHaveLength(1)
  expect(after[0]?.data).toBe(before[0]?.data)
})

it('100 次连续平移不写草稿，结束时只写一次最新视口，动作引用稳定', async () => {
  vi.spyOn(media, 'api').mockResolvedValue({ version: 0, document: { ...emptyDocument(), nodes: [node] } })
  const { result } = renderHook(() => useCanvas('performance', 'user'))
  await waitFor(() => expect(result.current.ready).toBe(true))
  vi.useFakeTimers()
  const write = vi.spyOn(Storage.prototype, 'setItem')
  const initial = result.current
  for (let index = 1; index <= 100; index++) act(() => result.current.view({ x: index, y: index, zoom: 1 }))
  expect(write).not.toHaveBeenCalled()
  expect(result.current.document.nodes).toBe(initial.document.nodes)
  expect(result.current.checkpoint).toBe(initial.checkpoint)
  expect(result.current.view).toBe(initial.view)
  act(() => result.current.flushDraft())
  expect(write).toHaveBeenCalledTimes(1)
  expect((JSON.parse(localStorage.getItem('genesis-media-draft:user:performance')!) as { document: media.Document }).document.viewport.x).toBe(100)
  act(() => { vi.advanceTimersByTime(300) })
  expect(write).toHaveBeenCalledTimes(1)
})

it('离开页面前补齐待写草稿，已成功保存后不重新写入旧草稿', async () => {
  vi.spyOn(media, 'api').mockImplementation((_path, method, body) => Promise.resolve({ version: method === 'PUT' ? 1 : 0, document: method === 'PUT' ? (body as { document: media.Document }).document : emptyDocument() }))
  const { result, unmount } = renderHook(() => useCanvas('flush', 'user'))
  await waitFor(() => expect(result.current.ready).toBe(true))
  act(() => result.current.apply({ ...result.current.document, nodes: [node] }, false))
  act(() => { window.dispatchEvent(new Event('pagehide')) })
  expect(localStorage.getItem('genesis-media-draft:user:flush')).toContain('正文')
  await act(() => result.current.save())
  unmount()
  expect(localStorage.getItem('genesis-media-draft:user:flush')).toBeNull()
})

it('只读平移、撤销和离开页面均不写入草稿或服务器', async () => {
  const request = vi.spyOn(media, 'api').mockResolvedValue({ version: 0, document: emptyDocument(), read_only: true })
  const { result, unmount } = renderHook(() => useCanvas('readonly', 'viewer'))
  await waitFor(() => expect(result.current.ready).toBe(true))
  const write = vi.spyOn(Storage.prototype, 'setItem')
  act(() => { result.current.view({ x: 50, y: 40, zoom: 1 }); result.current.checkpoint(); result.current.undo(); result.current.flushDraft() })
  unmount()
  expect(write).not.toHaveBeenCalled()
  expect(request).toHaveBeenCalledTimes(1)
})
