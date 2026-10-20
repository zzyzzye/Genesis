import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FpsMonitor } from '../src/features/performance/FpsMonitor'
import { fpsPreferenceKey, readFpsEnabled } from '../src/features/performance/preferences'
import { FpsSettings } from '../src/studio/FpsSettings'

const statsMocks = vi.hoisted<{
  instances: { dom: HTMLDivElement; update: ReturnType<typeof vi.fn> }[]
  originalPanel: unknown
}>(() => ({ instances: [], originalPanel: null }))

vi.mock('stats.js', () => {
  class MockStats {
    static Panel = class {
      dom = document.createElement('canvas')
      constructor(readonly name: string, readonly foreground: string, readonly background: string) {}
      update = vi.fn<(value: number, maxValue: number) => void>()
    }

    dom = document.createElement('div')
    panel: InstanceType<typeof MockStats.Panel>
    update = vi.fn(() => this.panel.update(59.6, 100))

    constructor() {
      this.panel = new MockStats.Panel('FPS', '#0ff', '#002')
      statsMocks.instances.push(this)
    }
  }
  statsMocks.originalPanel = MockStats.Panel
  return { default: MockStats }
})

let callbacks: Map<number, (time: number) => void>
let nextFrame: number

beforeEach(() => {
  callbacks = new Map()
  nextFrame = 0
  statsMocks.instances.length = 0
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: (time: number) => void) => {
    callbacks.set(++nextFrame, callback)
    return nextFrame
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => callbacks.delete(id)))
})

afterEach(() => {
  cleanup()
  localStorage.removeItem(fpsPreferenceKey)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function Harness() {
  return <><FpsSettings /><FpsMonitor /></>
}

describe('全站 FPS 监测', () => {
  it('默认关闭，不创建面板或动画循环；开启后仅展示 FPS，关闭立即释放', async () => {
    render(<Harness />)
    const toggle = screen.getByRole('switch', { name: '显示 FPS' })
    expect(toggle).not.toBeChecked()
    expect(statsMocks.instances).toHaveLength(0)
    expect(callbacks.size).toBe(0)
    fireEvent.click(toggle)
    await waitFor(() => expect(statsMocks.instances).toHaveLength(1))
    expect(toggle).toBeChecked()
    expect(readFpsEnabled()).toBe(true)
    const monitor = screen.getByRole('group', { name: '实时 FPS' })
    expect(monitor).toBeVisible()
    expect(monitor).toHaveTextContent('—FPS')
    expect(monitor.querySelector('canvas')).toBeNull()
    const { default: Stats } = await import('stats.js')
    expect(Stats.Panel).toBe(statsMocks.originalPanel)

    const [id, callback] = [...callbacks.entries()][0]!
    callbacks.delete(id)
    callback(1000)
    expect(statsMocks.instances[0]!.update).toHaveBeenCalledOnce()
    expect(monitor).toHaveTextContent('60FPS')
    expect(callbacks.size).toBe(1)
    fireEvent.click(toggle)
    expect(readFpsEnabled()).toBe(false)
    expect(callbacks.size).toBe(0)
    expect(screen.queryByRole('group', { name: '实时 FPS' })).not.toBeInTheDocument()
  })

  it('后台停止，回到前台重建计时基线，卸载清理订阅和循环', async () => {
    localStorage.setItem(fpsPreferenceKey, 'true')
    const view = render(<Harness />)
    await waitFor(() => expect(callbacks.size).toBe(1))
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    expect(callbacks.size).toBe(0)
    expect(screen.queryByRole('group', { name: '实时 FPS' })).not.toBeInTheDocument()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    fireEvent(document, new Event('visibilitychange'))
    expect(callbacks.size).toBe(1)
    expect(statsMocks.instances).toHaveLength(2)
    view.unmount()
    expect(callbacks.size).toBe(0)
    fireEvent(document, new Event('visibilitychange'))
    expect(statsMocks.instances).toHaveLength(2)
  })

  it('加载完成前关闭，不启动遗留面板', async () => {
    render(<Harness />)
    const toggle = screen.getByRole('switch', { name: '显示 FPS' })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(statsMocks.instances).toHaveLength(0)
    expect(callbacks.size).toBe(0)
  })

  it('StrictMode 重挂载只保留一个面板和一个循环', async () => {
    localStorage.setItem(fpsPreferenceKey, 'true')
    const view = render(<StrictMode><Harness /></StrictMode>)
    await waitFor(() => expect(callbacks.size).toBe(1))
    expect(screen.getAllByRole('group', { name: '实时 FPS' })).toHaveLength(1)
    expect(statsMocks.instances).toHaveLength(1)
    view.unmount()
    expect(callbacks.size).toBe(0)
  })

  it('保存失败保留原状态；已有偏好重挂载恢复，其他标签页关闭后同步停止', async () => {
    render(<Harness />)
    const toggle = screen.getByRole('switch', { name: '显示 FPS' })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(screen.getByRole('alert')).toHaveTextContent('检查存储权限后重试')
    expect(callbacks.size).toBe(0)
    vi.restoreAllMocks()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    fireEvent.click(toggle)
    await waitFor(() => expect(callbacks.size).toBe(1))
    cleanup()
    render(<Harness />)
    await waitFor(() => expect(callbacks.size).toBe(1))
    expect(screen.getByRole('switch', { name: '显示 FPS' })).toBeChecked()
    localStorage.removeItem(fpsPreferenceKey)
    fireEvent(window, new StorageEvent('storage', { key: fpsPreferenceKey }))
    expect(callbacks.size).toBe(0)
    expect(screen.getByRole('switch', { name: '显示 FPS' })).not.toBeChecked()
  })
})
