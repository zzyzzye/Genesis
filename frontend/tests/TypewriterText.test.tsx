import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TypewriterText } from '../src/studio/TypewriterText'

describe('增量打字机', () => {
  let frames: Map<number, FrameRequestCallback>
  let sequence: number
  let time: number
  function tick() {
    time += 34
    const pending = [...frames.values()]
    frames.clear()
    act(() => { for (const frame of pending) frame(time) })
  }
  beforeEach(() => {
    frames = new Map()
    sequence = 0
    time = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++sequence, callback)
      return sequence
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('分帧追加文本、保留 Unicode，追平后停止调度', () => {
    const content = '中文😀'.repeat(100)
    const progress = vi.fn()
    const view = render(<TypewriterText content={content} onProgress={progress} />)
    const text = view.container.querySelector('span')!
    tick()
    expect(text.textContent.length).toBeGreaterThan(0)
    expect(text.textContent.length).toBeLessThan(content.length)
    expect(text.textContent).not.toMatch(/[\uD800-\uDBFF]$/)
    const node = text.firstChild
    for (let i = 0; i < 50; i++) tick()
    expect(text.textContent).toBe(content)
    expect(text.firstChild).toBe(node)
    expect(frames.size).toBe(0)
    expect(progress.mock.calls.length).toBeLessThan(50)
  })

  it('快照被替换时重置文本，卸载时取消动画', () => {
    const progress = vi.fn()
    const view = render(<TypewriterText content="旧快照内容" onProgress={progress} />)
    tick()
    view.rerender(<TypewriterText content="新的完整快照" onProgress={progress} />)
    for (let i = 0; i < 10; i++) tick()
    expect(view.container.querySelector('span')).toHaveTextContent('新的完整快照')
    view.rerender(<TypewriterText content={'新的完整快照'.repeat(100)} onProgress={progress} />)
    expect(frames.size).toBe(1)
    view.unmount()
    expect(frames.size).toBe(0)
  })

  it('减少动态效果设置直接展示已收到的文字', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const content = '回复'.repeat(200)
    const view = render(<TypewriterText content={content} onProgress={() => undefined} />)
    tick()
    expect(view.container.querySelector('span')?.textContent).toBe(content)
    expect(frames.size).toBe(0)
  })
})
