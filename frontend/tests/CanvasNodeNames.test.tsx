import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDocument, type Document, type Node } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'
import { defaultNodeName, groupSelection, nodeTypeLabel, normalizeCanvasNodeNames } from '../src/pages/media/canvasOperations'
import { ProjectCanvas } from '../src/pages/media/ProjectCanvas'
import type { MediaCanvasActions } from '../src/pages/media/MediaAssistant'

vi.mock('../src/pages/media/VideoGeneration', () => ({ VideoGeneration: ({ controls }: { controls: import('react').ReactNode }) => controls, ImageGeneration: ({ controls }: { controls: import('react').ReactNode }) => controls }))

const types: Node['type'][] = ['note', 'text', 'shape', 'asset', 'group', 'video', 'image_generation', 'audio_generation', 'video_asset', 'image', 'audio']
const node = (type: Node['type'], extra: Partial<Node> = {}): Node => ({ id: crypto.randomUUID(), type, asset_id: null, text: '保留正文', x: 10, y: 20, width: 360, height: 240, ...extra })

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('统一节点名称', () => {
  it('所有类型补齐默认名，保留自定义名称与旧分组标题，迁移可重复执行', () => {
    const custom = node('note', { name: '便签 1' })
    const legacyGroup = node('group', { text: '开场分镜' })
    const document: Document = { ...emptyDocument(), nodes: [custom, ...types.map((type) => node(type, { name: '  ' })), legacyGroup] }
    const normalized = normalizeCanvasNodeNames(document)
    expect(normalized.nodes[0]).toBe(custom)
    expect(normalized.nodes[1]?.name).toBe('便签 2')
    expect(normalized.nodes.at(-1)).toMatchObject({ name: '开场分镜', text: '开场分镜' })
    expect(normalized.nodes.every((item) => item.name?.trim())).toBe(true)
    expect(normalized.nodes.map((item) => ({ ...item, name: undefined }))).toEqual(document.nodes.map((item) => ({ ...item, name: undefined })))
    expect(normalizeCanvasNodeNames(normalized)).toBe(normalized)
    expect(defaultNodeName('note', [custom, { name: '便签 3' }])).toBe('便签 2')
    const second = node('text')
    expect(groupSelection({ ...emptyDocument(), nodes: [custom, second] }, [custom.id, second.id])?.document.nodes[0]).toMatchObject({ type: 'group', name: '分组 1', text: '' })
  })

  it('各类标题可改名、取消、保留空名称原值，保存重开与撤销重做不影响正文和连线', async () => {
    vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1 })
    const nodes = types.map((type, index) => node(type, { x: index * 400, ...(type === 'group' ? { text: '', member_ids: [] } : {}) }))
    const edges = [{ id: 'reference', source: nodes[0]!.id, target: nodes[5]!.id }]
    let document: Document = { ...emptyDocument(), nodes, edges }
    let version = 0
    vi.spyOn(media, 'api').mockImplementation((path, method, body) => {
      if (path.endsWith('/canvas')) {
        if (method === 'PUT') { document = (body as { document: Document }).document; version += 1 }
        return Promise.resolve({ version, document })
      }
      return Promise.resolve(path.includes('/assets') ? { items: [], total: 0 } : { id: 'names', name: '名称验收', version: 0 })
    })
    let actions: MediaCanvasActions | null = null
    const renderCanvas = () => render(<MemoryRouter><ProjectCanvas projectId="names" userId="names-user" onAgentActionsChange={(value) => { actions = value }} /></MemoryRouter>)
    const view = renderCanvas()
    await screen.findByRole('textbox', { name: '便签名称' })
    const viewport = window.document.querySelector('.react-flow__viewport')?.getAttribute('style')
    for (const type of types) {
      const input = screen.getByRole('textbox', { name: `${nodeTypeLabel(type)}名称` })
      expect(input).toHaveValue(`${nodeTypeLabel(type)} 1`)
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: `我的${nodeTypeLabel(type)}` } })
      fireEvent.blur(input)
      expect(input).toHaveValue(`我的${nodeTypeLabel(type)}`)
    }
    const noteInput = screen.getByRole('textbox', { name: '便签名称' })
    fireEvent.focus(noteInput); fireEvent.change(noteInput, { target: { value: '   ' } }); fireEvent.blur(noteInput)
    expect(noteInput).toHaveValue('我的便签')
    // fireEvent 不执行浏览器原生 blur，显式补齐对应事件。
    fireEvent.focus(noteInput); fireEvent.change(noteInput, { target: { value: '取消改名' } }); fireEvent.keyDown(noteInput, { key: 'Escape' }); fireEvent.blur(noteInput)
    expect(noteInput).toHaveValue('我的便签')
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByRole('textbox', { name: '音频节点名称' })).toHaveValue('音频节点 1')
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(screen.getByRole('textbox', { name: '音频节点名称' })).toHaveValue('我的音频节点')
    expect(window.document.querySelector('.react-flow__viewport')?.getAttribute('style')).toBe(viewport)
    await act(async () => { await actions!.save() })
    expect(document.nodes.map((item) => item.name)).toEqual(types.map((type) => `我的${nodeTypeLabel(type)}`))
    expect(document.nodes.map((item) => item.text)).toEqual(nodes.map((item) => item.text))
    expect(document.edges).toEqual(edges)
    view.unmount()
    renderCanvas()
    await waitFor(() => expect(screen.getByRole('textbox', { name: '分组名称' })).toHaveValue('我的分组'))
    for (const type of types) expect(screen.getByRole('textbox', { name: `${nodeTypeLabel(type)}名称` })).toHaveValue(`我的${nodeTypeLabel(type)}`)
  })
})
