import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CursorEffects } from '../src/features/cursor/CursorEffects'
import { CursorTrail } from '../src/features/cursor/CursorTrail'
import { createDrawingSurface } from '../src/features/cursor/drawingSurface'
import { cursorPreferenceKey, cursorTrailKey } from '../src/features/cursor/preferences'

const context = {
  setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(),
  beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
}
let clock = 0, nextFrame = 0
const frames = new Map<number, FrameRequestCallback>()

function CursorTestTarget() {
  const [disabled, setDisabled] = useState(false)
  return <button disabled={disabled} onClick={() => setDisabled(true)}>体验</button>
}

function tick(time: number) {
  clock = time
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach(callback => callback(time))
}

function move(target: Element, x: number, y: number) {
  const event = new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  fireEvent(target, event)
}

beforeEach(() => {
  clock = 0; nextFrame = 0; frames.clear()
  vi.clearAllMocks()
  vi.stubGlobal('CanvasRenderingContext2D', class {})
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(any-pointer: fine)', addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
})

afterEach(() => {
  cleanup()
  localStorage.removeItem(cursorPreferenceKey); localStorage.removeItem(cursorTrailKey)
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('光标绘制性能与原生交互', () => {
  it('高频移动直接更新主造型，同一帧不重复读取样式或按钮布局', () => {
    localStorage.setItem(cursorPreferenceKey, 'follower'); localStorage.setItem(cursorTrailKey, 'silk')
    render(<><CursorEffects /><CursorTrail /><CursorTestTarget /></>)
    const style = vi.spyOn(window, 'getComputedStyle')
    const bounds = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    const button = screen.getByRole('button')
    style.mockClear()
    for (let i = 0; i < 480; i++) move(button, 200 + i / 10, 150)
    expect(document.querySelector<HTMLElement>('.genesis-cursor__shape')!.style.translate).toBe('247.9px 150px')
    expect(style).toHaveBeenCalledTimes(1)
    expect(bounds).not.toHaveBeenCalled()
    expect(frames.size).toBe(2)
    tick(16)
    const surfaces = document.querySelectorAll<HTMLCanvasElement>('.genesis-cursor canvas, [data-cursor-trail]')
    expect([...surfaces].every(canvas => canvas.width * canvas.height < 256 * 256)).toBe(true)
    const effect = document.querySelector<HTMLCanvasElement>('.genesis-cursor canvas')!
    expect(effect.width).toBe(1)
    fireEvent.pointerDown(button); tick(32)
    expect(effect.width).toBeGreaterThan(1)
    fireEvent.pointerUp(button); tick(600)
    expect(effect.width).toBe(1)
  })

  it('输入、文字选择和 CSS 特殊光标及时恢复原生指针，卸载清理帧和标记', () => {
    localStorage.setItem(cursorPreferenceKey, 'follower')
    const view = render(<><CursorEffects /><CursorTestTarget /><input aria-label="输入" /><div data-testid="resize" style={{ cursor: 'ew-resize' }}>调整</div></>)
    const button = screen.getByRole('button')
    move(button, 200, 150)
    expect(button).toHaveAttribute('data-genesis-cursor-target')
    move(screen.getByRole('textbox'), 250, 150)
    expect(document.documentElement.dataset.genesisCursor).toBeUndefined()
    expect(button).not.toHaveAttribute('data-genesis-cursor-target')
    move(button, 200, 150)
    move(screen.getByTestId('resize'), 260, 150)
    expect(document.documentElement.dataset.genesisCursor).toBeUndefined()
    move(button, 200, 150)
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection)
    fireEvent(document, new Event('selectionchange'))
    expect(document.documentElement.dataset.genesisCursor).toBeUndefined()
    selection.mockReturnValue({ isCollapsed: true } as Selection)
    fireEvent(document, new Event('selectionchange'))
    move(button, 200, 150)
    fireEvent.click(button)
    move(button, 201, 150)
    expect(document.documentElement.dataset.genesisCursor).toBeUndefined()
    view.unmount()
    expect(frames.size).toBe(0)
    expect(document.querySelector('[data-genesis-cursor-target]')).toBeNull()
  })

  it('拖尾在停下后消散并释放位图，不继续占用动画帧', () => {
    localStorage.setItem(cursorTrailKey, 'silk')
    render(<><CursorTrail /><CursorTestTarget /></>)
    move(screen.getByRole('button'), 200, 150); tick(16)
    move(screen.getByRole('button'), 240, 160); tick(32)
    const canvas = document.querySelector<HTMLCanvasElement>('[data-cursor-trail]')!
    expect(canvas.width).toBeGreaterThan(1)
    tick(700)
    expect(canvas).toHaveAttribute('hidden')
    expect(canvas.width * canvas.height).toBe(1)
    expect(frames.size).toBe(0)
  })

  it('减少动态效果时保留主造型，不为惯性或拖尾连续调度帧', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query !== '(forced-colors: active)', addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    localStorage.setItem(cursorPreferenceKey, 'follower'); localStorage.setItem(cursorTrailKey, 'silk')
    render(<><CursorEffects /><CursorTrail /><CursorTestTarget /></>)
    move(screen.getByRole('button'), 200, 150); tick(16)
    move(screen.getByRole('button'), 500, 200); tick(32)
    expect(document.querySelector('.genesis-cursor')).not.toHaveAttribute('hidden')
    expect(document.querySelector<HTMLElement>('.genesis-cursor')!.style.getPropertyValue('--cursor-stretch')).toBe('1')
    expect(document.querySelector<HTMLCanvasElement>('[data-cursor-trail]')!.width).toBe(1)
    expect(frames.size).toBe(0)
  })

  it('局部画布保留世界坐标，覆盖视口边缘并支持高分屏', () => {
    vi.stubGlobal('innerWidth', 1440); vi.stubGlobal('innerHeight', 1000); vi.stubGlobal('devicePixelRatio', 2)
    const canvas = document.createElement('canvas')
    const drawing = createDrawingSurface(canvas, context as unknown as CanvasRenderingContext2D)
    drawing.begin([{ x: 1439, y: 999 }], 20)
    expect(canvas.width).toBe(128)
    expect(canvas.height).toBe(128)
    expect(canvas.style.transform).toBe('translate3d(1376px, 936px, 0)')
    expect(context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, -2752, -1872)
    drawing.begin([{ x: 1430, y: 980 }], 20)
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 128, 128)
    drawing.begin([], 20)
    expect(canvas.width * canvas.height).toBe(1)
  })
})
