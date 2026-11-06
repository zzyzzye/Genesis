import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDocument, type Document } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'
import * as ai from '../src/lib/api'
import { accountAuthTokenKey } from '../src/lib/auth'
import { useCanvas } from '../src/pages/media/useCanvas'
import { MediaPage } from '../src/pages/media/MediaPage'

const node = { id: 'first', type: 'note' as const, name: '便签 1', asset_id: null, text: '原正文', x: 40, y: 80, width: 280, height: 220 }
const document = (): Document => ({ ...emptyDocument(), nodes: [node] })
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mockCanvas() {
  let server = document(), version = 0
  const request = vi.spyOn(media, 'api').mockImplementation((path, method, body) => {
    if (path.endsWith('/canvas')) {
      if (method === 'PUT') {
        expect((body as { version: number }).version).toBe(version)
        server = (body as { document: Document }).document
        version += 1
      }
      return Promise.resolve({ version, document: server })
    }
    return Promise.resolve(path.includes('/assets') ? { items: [], total: 0 } : { id: 'project', name: '合成画布', version })
  })
  return { request, rename: () => { server = { ...server, nodes: server.nodes.map(item => ({ ...item, name: '开场空镜' })) }; version += 1 }, changeLayout: () => { server = { ...server, nodes: server.nodes.map(item => ({ ...item, x: 999 })) }; version += 1 } }
}

describe('Agent 直接改名同步', () => {
  it('同步整张画布并可撤销；本地有新编辑时拒绝覆盖', async () => {
    const server = mockCanvas()
    const { result } = renderHook(() => useCanvas('project', 'canvas-tool-user'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    server.changeLayout()
    await act(async () => { await result.current.syncCanvas() })
    expect(result.current.document.nodes[0]?.x).toBe(999)
    act(() => result.current.undo())
    expect(result.current.document.nodes[0]?.x).toBe(40)
    await act(async () => { await expect(result.current.syncCanvas()).rejects.toThrow('未覆盖本地编辑') })
    expect(result.current.conflict).toBe(true)
    expect(result.current.document.nodes[0]?.x).toBe(40)
  })
  it('合并改名并保留本地正文和位置，更新保存版本，重放不增加撤销步骤', async () => {
    const server = mockCanvas()
    const { result } = renderHook(() => useCanvas('project', 'rename-user'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => { result.current.apply({ ...result.current.current.current, nodes: [{ ...node, text: '本地正文', x: 120 }] }) })
    server.rename()
    await act(async () => { await result.current.syncNodeNames() })
    expect(result.current.document.nodes[0]).toMatchObject({ name: '开场空镜', text: '本地正文', x: 120 })
    await act(async () => { await result.current.save(); await result.current.syncNodeNames() })
    expect(server.request.mock.calls.find(([, method]) => method === 'PUT')?.[2]).toMatchObject({ version: 1, document: { nodes: [{ name: '开场空镜', text: '本地正文', x: 120 }] } })
    act(() => result.current.undo())
    expect(result.current.document.nodes[0]).toMatchObject({ name: '便签 1', text: '本地正文', x: 120 })
    act(() => result.current.redo())
    expect(result.current.document.nodes[0]?.name).toBe('开场空镜')
  })

  it('本地后来改名优先保留，后台回执不覆盖用户的新名称', async () => {
    const server = mockCanvas()
    const { result } = renderHook(() => useCanvas('project', 'rename-user'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.apply({ ...document(), nodes: [{ ...node, name: '我刚改的名字' }] }))
    server.rename()
    await act(async () => { await result.current.syncNodeNames(); await result.current.save() })
    expect(result.current.document.nodes[0]?.name).toBe('我刚改的名字')
    expect(server.request.mock.calls.find(([, method]) => method === 'PUT')?.[2]).toMatchObject({ version: 1, document: { nodes: [{ name: '我刚改的名字' }] } })
  })

  it('远端有其他内容修改时保留本地并进入原有冲突处理，不盲目覆盖', async () => {
    const server = mockCanvas()
    const { result } = renderHook(() => useCanvas('project', 'rename-user'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.apply({ ...document(), nodes: [{ ...node, text: '未保存的正文' }] }))
    server.rename(); server.changeLayout()
    await act(async () => { await expect(result.current.syncNodeNames()).rejects.toThrow('已保留本地草稿') })
    expect(result.current.conflict).toBe(true)
    expect(result.current.document.nodes[0]).toMatchObject({ name: '便签 1', text: '未保存的正文', x: 40 })
    await expect(result.current.save()).rejects.toThrow('处理保存冲突')
    expect(server.request.mock.calls.some(([, method]) => method === 'PUT')).toBe(false)
  })

  it('同步等待正在进行的保存，名称专属的 409 可安全合并并恢复后续保存', async () => {
    const server = mockCanvas()
    const { result } = renderHook(() => useCanvas('project', 'rename-user'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.apply({ ...document(), nodes: [{ ...node, text: '本地正文' }] }))
    let rejectSave!: (reason: Error) => void
    server.request.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject }))
    let saving!: Promise<void>, syncing!: Promise<void>
    act(() => { saving = result.current.save(); syncing = result.current.syncNodeNames() })
    const handledSave = saving.catch(() => undefined)
    expect(server.request.mock.calls.filter(([, method]) => method !== 'PUT')).toHaveLength(1)
    server.rename()
    await act(async () => { rejectSave(new media.MediaError(409, '作品已在其他窗口修改')); await handledSave; await syncing; await result.current.save() })
    expect(result.current.conflict).toBe(false)
    expect(result.current.document.nodes[0]).toMatchObject({ name: '开场空镜', text: '本地正文' })
  })

  it.each(['rename_node', 'edit_media_canvas'] as const)('%s 原生回执自动刷新画布，无需应用按钮', async name => {
    const server = mockCanvas()
    vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1 })
    localStorage.setItem(accountAuthTokenKey, 'synthetic-session')
    vi.spyOn(ai, 'getCurrentUser').mockResolvedValue({ id: 'user', handle: 'synthetic', display_name: '合成测试', role: 'owner', bio: '', avatar_url: null })
    vi.spyOn(ai, 'getProviderModels').mockResolvedValue({ provider: 'openai', models: [] })
    vi.spyOn(ai, 'createAiConversation').mockResolvedValue({ id: 'conversation', title: '新对话', title_source: 'manual', created_at: '', updated_at: '' })
    vi.spyOn(ai, 'createAiChatRun').mockResolvedValue({ id: 'run', status: 'pending' })
    let handlers!: Parameters<typeof ai.streamAiChatRun>[2]
    vi.spyOn(ai, 'streamAiChatRun').mockImplementation((_token, _run, callbacks) => { handlers = callbacks; return new Promise(() => {}) })
    render(<MemoryRouter initialEntries={['/media/projects/project/canvas']}><Routes><Route path="/media/projects/:projectId/canvas" element={<MediaPage />} /></Routes></MemoryRouter>)
    const element = await screen.findByTestId('rf__node-first')
    fireEvent.click(screen.getByRole('button', { name: '镜头搭档' }))
    fireEvent.change(screen.getByRole('textbox', { name: '向镜头搭档提问' }), { target: { value: '把这个节点改名为开场空镜' } })
    fireEvent.click(screen.getByRole('button', { name: '发送给镜头搭档' }))
    await waitFor(() => expect(handlers).toBeDefined())
    const input = screen.getByRole('textbox', { name: '便签名称' })
    fireEvent.focus(input)
    server.rename()
    const call: ai.AiToolCall = { id: 'rename-call', name, label: '修改画布', status: 'succeeded', started_at: '', parameter_names: [], input_summary: '', duration_ms: 1, result_summary: '工具执行完成', proposal_id: null, resource: { module: 'media', kind: name === 'rename_node' ? 'canvas_node_rename' : 'canvas_edit', id: 'rename-receipt', scope_id: 'project', parent_id: 'first' } }
    await act(async () => { handlers.onToolCalls?.([call]); await Promise.resolve() })
    await waitFor(() => expect(element).toHaveAttribute('aria-label', '开场空镜'))
    fireEvent.blur(input)
    expect(input).toHaveValue('开场空镜')
    expect(screen.queryByRole('button', { name: '应用到画布' })).not.toBeInTheDocument()
    const reads = server.request.mock.calls.filter(([path]) => path.endsWith('/canvas')).length
    await act(async () => { handlers.onToolCalls?.([call]); await Promise.resolve() })
    expect(server.request.mock.calls.filter(([path]) => path.endsWith('/canvas'))).toHaveLength(reads)
    expect(server.request.mock.calls.some(([path]) => path.includes('image-generations'))).toBe(false)
  })
})
