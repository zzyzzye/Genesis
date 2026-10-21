import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useChatAutoScroll } from '../src/features/agent/useChatAutoScroll'

let height = 1200
let viewport = 300
let top = 0
let nextFrame = 0
const frames = new Map<number, FrameRequestCallback>()
const observers: { resize: () => void; disconnect: ReturnType<typeof vi.fn> }[] = []

function Fixture({ active = true, conversation = 'one' }: { active?: boolean; conversation?: string }) {
  const { bodyRef, contentRef, scrollToLatest } = useChatAutoScroll(active, conversation)
  return <><div data-testid="messages" ref={node => {
    bodyRef.current = node
    if (!node) return
    Object.defineProperties(node, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, get: () => viewport },
      scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, height - viewport)) } },
    })
  }}><div ref={contentRef}><textarea aria-label="输入" /></div></div><button onClick={scrollToLatest}>发送</button></>
}

function flush() {
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)) })
}
function resize() { act(() => observers.at(-1)?.resize()); flush() }

beforeEach(() => {
  height = 1200; viewport = 300; top = 0; frames.clear(); observers.length = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn()
    observe() {}
    unobserve() {}
    constructor(callback: () => void) { observers.push({ resize: callback, disconnect: this.disconnect }) }
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('默认到底部，消息增长和容器变窄增高不会意外暂停跟随', () => {
  render(<Fixture />); flush()
  expect(top).toBe(900)
  height = 1500
  fireEvent.scroll(screen.getByTestId('messages'))
  resize()
  expect(top).toBe(1200)
  viewport = 200
  resize()
  expect(top).toBe(1300)
})

it('拖动滚动条上翻后保持位置，回到底部后恢复跟随', () => {
  render(<Fixture />); flush()
  const body = screen.getByTestId('messages')
  top = 450; fireEvent.scroll(body)
  height += 200; resize()
  expect(top).toBe(450)
  top = height - viewport; fireEvent.scroll(body)
  height += 200; resize()
  expect(top).toBe(height - viewport)
})

it('内容收起导致位置被浏览器收紧后，后续输出仍然跟随', () => {
  render(<Fixture />); flush()
  height = 700; top = 400
  fireEvent.scroll(screen.getByTestId('messages'))
  resize()
  height = 1100; resize()
  expect(top).toBe(800)
})

it.each(['wheel', 'keyboard', 'touch'])('%s 向上浏览能在待处理的跟随帧之前暂停', method => {
  render(<Fixture />); flush()
  const body = screen.getByTestId('messages')
  height += 100
  act(() => observers.at(-1)?.resize())
  if (method === 'wheel') fireEvent.wheel(body, { deltaY: -10 })
  if (method === 'keyboard') fireEvent.keyDown(body, { key: 'PageUp' })
  if (method === 'touch') {
    fireEvent.touchStart(body, { touches: [{ clientY: 100 }] })
    fireEvent.touchMove(body, { touches: [{ clientY: 120 }] })
  }
  flush()
  expect(top).toBe(900)
  height += 100; resize()
  expect(top).toBe(900)
  fireEvent.click(screen.getByRole('button', { name: '发送' })); flush()
  expect(top).toBe(height - viewport)
})

it('输入区方向键不暂停跟随，切换对话与重新打开恢复底部', () => {
  const view = render(<Fixture />); flush()
  fireEvent.keyDown(screen.getByLabelText('输入'), { key: 'ArrowUp' })
  height += 100; resize()
  expect(top).toBe(1000)
  top = 100; fireEvent.scroll(screen.getByTestId('messages'))
  view.rerender(<Fixture conversation="two" />); flush()
  expect(top).toBe(1000)
  top = 100; fireEvent.scroll(screen.getByTestId('messages'))
  view.rerender(<Fixture active={false} />)
  view.rerender(<Fixture />); flush()
  expect(top).toBe(1000)
  view.unmount()
  expect(observers.at(-1)?.disconnect).toHaveBeenCalled()
  expect(frames.size).toBe(0)
})
