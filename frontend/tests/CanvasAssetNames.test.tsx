import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as media from '../src/pages/media/api'
import { useCanvas } from '../src/pages/media/useCanvas'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

it('保存后采用素材记录名称，保留正在编辑的正文与节点位置', async () => {
  const node: media.Node = { id:'result', type:'image', name:'原成品', asset_id:'asset', text:'', x:80, y:60, width:360, height:280 }
  const document: media.Document = { ...media.emptyDocument(), nodes:[node] }
  vi.spyOn(media, 'api').mockImplementation((path, method, body) => {
    if (method === 'PUT') {
      const input = body as { document: media.Document }
      return Promise.resolve({ version:1, document:{ ...input.document, nodes:input.document.nodes.map(item => ({ ...item, name:'数据库成品名' })) } })
    }
    return Promise.resolve({ version:0, document, path })
  })
  const { result } = renderHook(() => useCanvas('names', 'names-user'))
  await waitFor(() => expect(result.current.ready).toBe(true))
  act(() => result.current.apply({ ...result.current.document, nodes:[{ ...node, name:'待校准名称', x:120 }] }))
  await act(() => result.current.save())
  expect(result.current.document.nodes[0]).toMatchObject({ name:'数据库成品名', x:120, asset_id:'asset' })
  expect(result.current.status).toBe('已保存')
})

it('保存回执不会覆盖请求发出后继续修改的成品名', async () => {
  const node: media.Node = { id:'result', type:'image', name:'原成品', asset_id:'asset', text:'', x:80, y:60, width:360, height:280 }
  const document: media.Document = { ...media.emptyDocument(), nodes:[node] }
  let complete!: (value: media.Snapshot) => void
  vi.spyOn(media, 'api').mockImplementation((_path, method) => method === 'PUT' ? new Promise(resolve => { complete = resolve }) : Promise.resolve({ version:0, document }))
  const { result } = renderHook(() => useCanvas('late-names', 'names-user'))
  await waitFor(() => expect(result.current.ready).toBe(true))
  act(() => result.current.apply({ ...document, nodes:[{ ...node, name:'第一次改名' }] }))
  let saving!: Promise<void>
  act(() => { saving = result.current.save() })
  act(() => result.current.apply({ ...document, nodes:[{ ...node, name:'继续编辑的新名' }] }))
  await act(async () => { complete({ version:1, document:{ ...document, nodes:[{ ...node, name:'第一次改名' }] } }); await saving })
  expect(result.current.document.nodes[0]?.name).toBe('继续编辑的新名')
  expect(result.current.status).toBe('有待保存修改')
})
