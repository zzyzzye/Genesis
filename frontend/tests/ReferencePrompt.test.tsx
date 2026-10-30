import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReferencePrompt, type ReferencePromptHandle } from '../src/pages/media/ReferencePrompt'
import { connectReference, displayPrompt, imageMentionToken, imageReferenceNumbers, incomingReferences } from '../src/pages/media/canvasReferences'
import { defaultGenerationSettings, emptyDocument, type Node } from '../src/pages/media/api'

afterEach(cleanup)
const source: Node = { id: '11111111-1111-4111-8111-111111111111', type: 'image', asset_id: 'asset', name: '生串上架', text: '', x: 0, y: 0, width: 360, height: 203 }
const target: Node = { ...source, id: '22222222-2222-4222-8222-222222222222', type: 'video', asset_id: null, generation: defaultGenerationSettings() }

it('连线幂等、进入参考模式并拒绝失效来源，引用绑定节点而非序号', () => {
  const doc = { ...emptyDocument(), nodes: [source, target] }
  const connected = connectReference(doc, source.id, target.id)
  expect(connected.nodes[1]?.generation?.mode).toBe('reference')
  expect(connectReference(connected, source.id, target.id)).toBe(connected)
  expect(() => connectReference(doc, 'missing', target.id)).toThrow('已失效')
  expect(() => connectReference(doc, source.id, source.id)).toThrow('已失效')
  expect(displayPrompt(imageMentionToken(source.id), incomingReferences(connected, target.id, {}))).toBe('@图片1')
  expect(displayPrompt(imageMentionToken(source.id), [])).toBe('@已断开图片')
})

it('在光标处插入图片标签；名称变化不改绑定，断线后显示缺失且不抹掉提示词', () => {
  const ref = createRef<ReferencePromptHandle>()
  const change = vi.fn()
  const props = { ref, value: '烤制：', references: [{ node: source, asset: undefined }], label: '镜头描述', onChange: change, onFocus: vi.fn(), onBlur: vi.fn() }
  const { rerender } = render(<ReferencePrompt {...props} />)
  act(() => ref.current?.insertImage(source.id))
  expect(change).toHaveBeenLastCalledWith(`${imageMentionToken(source.id)} 烤制：`)
  expect(screen.getByText('@图片1 · 生串上架')).toBeInTheDocument()
  const value = `${imageMentionToken(source.id)} 烤制：`
  change.mockClear()
  rerender(<ReferencePrompt {...props} value={value} references={[{ node: { ...source, name: '更名后的图' }, asset: undefined }]} />)
  expect(screen.getByText('@图片1 · 更名后的图')).toBeInTheDocument()
  expect(change).not.toHaveBeenCalled()
  rerender(<ReferencePrompt {...props} value={value} references={[]} />)
  expect(screen.getByText('@已断开图片')).toBeInTheDocument()
  expect(change).not.toHaveBeenCalled()
})

it('同一文件的多个来源节点共享图片序号，顺序变化时标签跟随实际发送顺序', () => {
  const duplicate = { ...source, id: 'duplicate' }
  const second = { ...source, id: 'second', asset_id: 'second-asset' }
  const references = [second, source, duplicate].map(node => ({ node, asset: undefined }))
  expect([...imageReferenceNumbers(references)]).toEqual([[second.id, 1], [source.id, 2], [duplicate.id, 2]])
  expect(displayPrompt(imageMentionToken(source.id), references)).toBe('@图片2')
  expect(displayPrompt(imageMentionToken(source.id), references.slice(1))).toBe('@图片1')
})
