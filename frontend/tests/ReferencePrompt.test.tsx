import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { acceptCompletion, startCompletion } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import { createRef, useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReferencePrompt, type ReferencePromptHandle } from '../src/pages/media/ReferencePrompt'
import { connectReference, displayPrompt, imageMentionToken, imageReferenceNumbers, incomingReferences, promptReferences, textMentionToken } from '../src/pages/media/canvasReferences'
import { defaultGenerationSettings, emptyDocument, type Node } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'
import { duplicateCanvasSelection } from '../src/pages/media/canvasOperations'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const source: Node = { id: '11111111-1111-4111-8111-111111111111', type: 'image', asset_id: 'asset', name: '生串上架', text: '', x: 0, y: 0, width: 360, height: 203 }
const target: Node = { ...source, id: '22222222-2222-4222-8222-222222222222', type: 'video', asset_id: null, generation: defaultGenerationSettings() }

it.each(['镜头描述', '图片提示词'])('文字引用在%s保留稳定标签，改名更新且断线显示失效', async label => {
  const text = { ...source, type:'text' as const, asset_id:null, name:'人物设定', text:'白色衬衫' }
  const change = vi.fn()
  const props = { value:'@', label, onChange:change, onFocus:() => {}, onBlur:() => {} }
  const { rerender } = render(<ReferencePrompt {...props} references={[{ node:text, asset:undefined }]} />)
  const editor = EditorView.findFromDOM(screen.getByRole('textbox', { name:label }))!
  act(() => { editor.focus(); editor.dispatch({ selection:{ anchor:1 } }); startCompletion(editor) })
  const option = await screen.findByRole('option')
  expect(option).toHaveTextContent('人物设定')
  expect(option).toHaveTextContent('最新文字')
  fireEvent.pointerMove(option.querySelector('.media-reference-option')!)
  await waitFor(() => { act(() => { acceptCompletion(editor) }); expect(change).toHaveBeenLastCalledWith(`${textMentionToken(text.id)} `) })
  const value = `${textMentionToken(text.id)} `
  rerender(<ReferencePrompt {...props} value={value} references={[{ node:{ ...text, name:'新人物设定', text:'黑色外套' }, asset:undefined }]} />)
  expect(screen.getByText('新人物设定', { selector:'.media-prompt-mention' })).toBeInTheDocument()
  expect(editor.state.doc.toString()).toBe(value)
  rerender(<ReferencePrompt {...props} value={value} references={[]} />)
  expect(screen.getByText('已断开文字', { selector:'.is-missing' })).toBeInTheDocument()
})

it('仅直接连接的文字和图片进入候选，文字连接不会变成图生图模式', () => {
  const text: Node = { ...source, id:'text', type:'text', asset_id:null, name:'人物设定', text:'白衬衫' }
  const disconnected: Node = { ...text, id:'unconnected' }
  const doc = connectReference({ ...emptyDocument(), nodes:[source, text, disconnected, target] }, text.id, target.id)
  const refs = promptReferences(incomingReferences(doc, target.id, {}))
  expect(refs.map(entry => entry.node.id)).toEqual(['text'])
  expect(doc.nodes.find(node => node.id === target.id)?.generation?.mode).toBe('text')
  expect(displayPrompt(textMentionToken(text.id), refs)).toBe('人物设定')
  expect(displayPrompt(textMentionToken(disconnected.id), refs)).toBe('已断开文字')
  const withMention = { ...doc, nodes:doc.nodes.map(node => node.id === target.id ? { ...node, text:textMentionToken(text.id) } : node) }
  const copy = duplicateCanvasSelection(withMention, [text.id, target.id])
  expect(copy.document.nodes.find(node => node.id === copy.idMap.get(target.id))?.text).toBe(textMentionToken(copy.idMap.get(text.id)!))
  const targetOnly = duplicateCanvasSelection(withMention, [target.id])
  expect(targetOnly.document.nodes.at(-1)?.text).toBe(textMentionToken(text.id))
})

it('拼音组字期间不回写画布或重配引用，确认中文后一次提交并保留后续输入', async () => {
  const change = vi.fn()
  function ControlledPrompt({ references }: { references: Parameters<typeof ReferencePrompt>[0]['references'] }) {
    const [value, setValue] = useState('')
    return <ReferencePrompt value={value} references={references} label="镜头描述" onChange={text => { change(text); setValue(text) }} onFocus={() => {}} onBlur={() => {}} />
  }
  const { rerender } = render(<ControlledPrompt references={[{ node:source, asset:undefined }]} />)
  const textbox = screen.getByRole('textbox', { name:'镜头描述' })
  const editor = EditorView.findFromDOM(textbox)!
  act(() => editor.focus())
  fireEvent.compositionStart(textbox)
  act(() => editor.dispatch({ changes:{ from:0, insert:'n' } }))
  expect(change).not.toHaveBeenCalled()
  // 素材刷新不能在输入法组字中途重建引用插件。
  rerender(<ControlledPrompt references={[{ node:{ ...source, name:'新名称' }, asset:undefined }]} />)
  act(() => editor.dispatch({ changes:{ from:0, to:1, insert:'ni' } }))
  expect(change).not.toHaveBeenCalled()
  act(() => editor.dispatch({ changes:{ from:0, to:2, insert:'你' } }))
  fireEvent.compositionEnd(textbox, { data:'你' })
  await waitFor(() => expect(change).toHaveBeenLastCalledWith('你'))
  expect(change).toHaveBeenCalledTimes(1)
  expect(EditorView.findFromDOM(textbox)).toBe(editor)
  expect(textbox).toHaveFocus()
  act(() => editor.dispatch({ changes:{ from:1, insert:'好' } }))
  expect(change).toHaveBeenLastCalledWith('你好')
})

it('compositionend 之后到达的最终 DOM 输入仍以确认的中文提交', async () => {
  const change = vi.fn()
  function ControlledPrompt() {
    const [value, setValue] = useState('')
    return <ReferencePrompt value={value} references={[]} label="图片提示词" onChange={text => { change(text); setValue(text) }} onFocus={() => {}} onBlur={() => {}} />
  }
  render(<ControlledPrompt />)
  const textbox = screen.getByRole('textbox', { name:'图片提示词' })
  const editor = EditorView.findFromDOM(textbox)!
  act(() => editor.focus())
  fireEvent.compositionStart(textbox)
  act(() => editor.dispatch({ changes:{ from:0, insert:'ni' } }))
  fireEvent.compositionEnd(textbox, { data:'你' })
  // 浏览器可以先结束 composition，再派发最后一次 input/DOM 变更。
  act(() => {
    textbox.querySelector('.cm-line')!.textContent = '你'
    fireEvent.input(textbox, { inputType:'insertText', data:'你' })
  })
  await waitFor(() => expect(change).toHaveBeenLastCalledWith('你'))
  expect(change).toHaveBeenCalledTimes(1)
  expect(textbox).toHaveTextContent('你')
})

it('候选显示真实缩略图，鼠标移动同步原生选中并提交对应节点，卸载释放预览', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reference-option')
  vi.spyOn(media, 'fileBlob').mockResolvedValue(new Blob(['image']))
  const asset: media.Asset = { id:'asset', name:'人物.png', kind:'image', mime_type:'image/png', size:5, in_library:false }
  const change = vi.fn()
  const { unmount } = render(<ReferencePrompt value="@" references={[{ node:source, asset }, { node:{ ...source, id:'scene', name:'场景.png' }, asset }]} label="镜头描述" onChange={change} onFocus={() => {}} onBlur={() => {}} />)
  const editor = EditorView.findFromDOM(screen.getByRole('textbox', { name:'镜头描述' }))!
  act(() => { editor.focus(); editor.dispatch({ selection:{ anchor:1 } }); startCompletion(editor) })
  const options = await screen.findAllByRole('option')
  await waitFor(() => expect(options.every(option => option.querySelector('img')?.getAttribute('src') === 'blob:reference-option')).toBe(true))
  expect(media.fileBlob).toHaveBeenCalledTimes(1)
  const person = screen.getByText('生串上架', { selector:'.media-reference-option-name' })
  fireEvent.pointerMove(person)
  expect(person.closest('[role="option"]')).toHaveAttribute('aria-selected', 'true')
  const scene = screen.getByText('场景.png', { selector:'.media-reference-option-name' })
  fireEvent.pointerMove(scene)
  expect(scene.closest('[role="option"]')).toHaveAttribute('aria-selected', 'true')
  await waitFor(() => {
    act(() => { acceptCompletion(editor) })
    expect(change).toHaveBeenLastCalledWith(`${imageMentionToken('scene')} `)
  })
  unmount()
  expect(revoke).toHaveBeenCalledWith('blob:reference-option')
})

it('候选预览失败和素材未就绪仍保留名称及状态，不阻塞引用菜单', async () => {
  vi.spyOn(media, 'fileBlob').mockRejectedValue(new Error('图片不可用'))
  const asset: media.Asset = { id:'failed', name:'失败.png', kind:'image', mime_type:'image/png', size:5, in_library:false }
  render(<ReferencePrompt value="@" references={[{ node:source, asset }, { node:{ ...source, id:'pending', name:'等待生成' }, asset:undefined }]} label="图片提示词" onChange={() => {}} onFocus={() => {}} onBlur={() => {}} />)
  const editor = EditorView.findFromDOM(screen.getByRole('textbox', { name:'图片提示词' }))!
  act(() => { editor.focus(); editor.dispatch({ selection:{ anchor:1 } }); startCompletion(editor) })
  await screen.findAllByRole('option')
  expect(await screen.findByTitle('素材加载失败')).toHaveTextContent('图')
  expect(screen.getByText('等待生成', { selector:'.media-reference-option-name' })).toBeInTheDocument()
  expect(screen.getByText('图片未就绪', { selector:'.media-reference-option-detail' })).toBeInTheDocument()
  expect(media.fileBlob).toHaveBeenCalledTimes(1)
})

it('连线幂等、不因候选连线进入参考模式并拒绝失效来源，引用绑定节点而非序号', () => {
  const doc = { ...emptyDocument(), nodes: [source, target] }
  const connected = connectReference(doc, source.id, target.id)
  expect(connected.nodes[1]?.generation?.mode).toBe('text')
  expect(connectReference(connected, source.id, target.id)).toBe(connected)
  expect(() => connectReference(doc, 'missing', target.id)).toThrow('已失效')
  expect(() => connectReference(doc, source.id, source.id)).toThrow('已失效')
  expect(displayPrompt(imageMentionToken(source.id), incomingReferences(connected, target.id, {}))).toBe('生串上架')
  expect(displayPrompt(imageMentionToken(source.id), [])).toBe('已断开图片')
})

it('在光标处插入图片标签；名称变化不改绑定，断线后显示缺失且不抹掉提示词', () => {
  const ref = createRef<ReferencePromptHandle>()
  const change = vi.fn()
  const props = { ref, value: '烤制：', references: [{ node: source, asset: undefined }], label: '镜头描述', onChange: change, onFocus: vi.fn(), onBlur: vi.fn() }
  const { rerender } = render(<ReferencePrompt {...props} />)
  act(() => ref.current?.insertImage(source.id))
  expect(change).toHaveBeenLastCalledWith(`${imageMentionToken(source.id)} 烤制：`)
  expect(screen.getByText('生串上架')).toBeInTheDocument()
  const value = `${imageMentionToken(source.id)} 烤制：`
  change.mockClear()
  rerender(<ReferencePrompt {...props} value={value} references={[{ node: { ...source, name: '更名后的图' }, asset: undefined }]} />)
  expect(screen.getByText('更名后的图')).toBeInTheDocument()
  expect(change).not.toHaveBeenCalled()
  rerender(<ReferencePrompt {...props} value={value} references={[]} />)
  expect(screen.getByText('已断开图片')).toBeInTheDocument()
  expect(change).not.toHaveBeenCalled()
  act(() => ref.current?.insertImage(source.id))
  expect(change).not.toHaveBeenCalled()
})

it('同一文件共享上传序号，标签始终只显示名称，不随参考顺序变化', () => {
  const duplicate = { ...source, id: 'duplicate' }
  const second = { ...source, id: 'second', asset_id: 'second-asset' }
  const references = [second, source, duplicate].map(node => ({ node, asset: undefined }))
  expect([...imageReferenceNumbers(references)]).toEqual([[second.id, 1], [source.id, 2], [duplicate.id, 2]])
  expect(displayPrompt(imageMentionToken(source.id), references)).toBe('生串上架')
  expect(displayPrompt(imageMentionToken(source.id), references.slice(1))).toBe('生串上架')
})
