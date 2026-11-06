import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import * as media from '../src/pages/media/api'
import { ProjectCanvas } from '../src/pages/media/ProjectCanvas'
import { textMentionToken } from '../src/pages/media/canvasReferences'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['image_generation', 'video'] as const)('%s 的参考条与管理入口均插入文字标签，保存后保持引用', async type => {
  vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1 })
  const source: media.Node = { id:crypto.randomUUID(), type:'text', asset_id:null, name:'人物设定', text:'白衬衫', x:0, y:0, width:300, height:180 }
  const target: media.Node = { ...source, id:crypto.randomUUID(), type, name:'生成', text:'', x:400 }
  let document: media.Document = { ...media.emptyDocument(), nodes:[source, target], edges:[{ id:crypto.randomUUID(), source:source.id, target:target.id }] }
  vi.spyOn(media, 'api').mockImplementation((path, method, body) => {
    if (path.endsWith('/canvas')) {
      if (method === 'PUT') document = (body as {document:media.Document}).document
      return Promise.resolve({version:0, document})
    }
    return Promise.resolve(path.includes('/assets') ? {items:[],total:0} : path.includes('models') ? {items:[]} : {id:'project',name:'文字引用验收'})
  })
  render(<MemoryRouter><ProjectCanvas projectId="project" userId="user" /></MemoryRouter>)
  fireEvent.click(await screen.findByTestId(`rf__node-${target.id}`))
  const input = screen.getByRole('textbox', {name:type === 'video' ? '镜头描述' : '图片提示词'})
  fireEvent.click(screen.getByRole('button', {name:'引用参考：人物设定'}))
  expect(EditorView.findFromDOM(input)!.state.doc.toString()).toBe(`${textMentionToken(source.id)} `)
  fireEvent.click(screen.getByRole('button', {name:'画布参考 · 1'}))
  fireEvent.click(screen.getByRole('button', {name:'引用文字'}))
  expect(input.querySelectorAll('.media-prompt-mention')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', {name:'作品菜单'}))
  fireEvent.click(screen.getByRole('button', {name:'立即保存 / 重试'}))
  await waitFor(() => expect(document.nodes.find(node => node.id === target.id)?.text).toBe(`${textMentionToken(source.id)} ${textMentionToken(source.id)} `))
  fireEvent.click(screen.getByRole('button', {name:'断开参考：人物设定'}))
  expect(input.querySelectorAll('.is-missing')).toHaveLength(2)
}, 15000)
