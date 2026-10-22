import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TagCloud } from '../src/components/TagCloud'

const mocks = vi.hoisted(() => {
  const chart = {
    on: vi.fn<(name: string, listener: (event: unknown) => void) => void>(),
    setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), dispatchAction: vi.fn(),
  }
  return { chart, createCloudChart: vi.fn(() => chart), cloudOption: vi.fn(() => ({})), animateSpeed: vi.fn(() => ({ stop: vi.fn() })) }
})

vi.mock('../src/components/tagCloudChart', () => ({ createCloudChart: mocks.createCloudChart, cloudOption: mocks.cloudOption }))
vi.mock('motion/react', () => ({ animate: mocks.animateSpeed }))

describe('ECharts 标签词云', () => {
  beforeEach(() => {
    vi.stubGlobal('CanvasRenderingContext2D', class {})
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(180)
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })

  it('图表点击使用最新标签和回调，禁用后不触发，卸载释放实例', async () => {
    const first = vi.fn()
    const latest = vi.fn()
    const view = render(<TagCloud label="标签" items={[{ id: 'first', name: '旧标签', count: 1 }]} onSelect={first} />)
    await waitFor(() => expect(mocks.chart.on).toHaveBeenCalled())
    const click = mocks.chart.on.mock.calls.find(([name]) => name === 'click')![1]
    act(() => click({ dataIndex: 0 }))
    expect(first).toHaveBeenCalledWith('first')

    view.rerender(<TagCloud label="标签" items={[{ id: 'latest', name: '新标签', count: 2 }]} onSelect={latest} />)
    act(() => click({ dataIndex: 0 }))
    expect(latest).toHaveBeenCalledWith('latest')
    expect(mocks.createCloudChart).toHaveBeenCalledTimes(1)

    view.rerender(<TagCloud label="标签" items={[{ id: 'latest', name: '新标签', count: 2 }]} onSelect={latest} disabled />)
    act(() => click({ dataIndex: 0 }))
    expect(latest).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(mocks.chart.dispose).toHaveBeenCalledTimes(1)
  })

  it('键盘按钮提供完整名称、数量和选中状态，并同步图表强调与提示', async () => {
    const select = vi.fn()
    render(<TagCloud label="标签" items={[{ id: 'tag', name: '完整标签名称', count: 3 }]} selectedId="tag" onSelect={select} />)
    await waitFor(() => expect(mocks.createCloudChart).toHaveBeenCalled())
    const button = screen.getByRole('button', { name: '完整标签名称' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAccessibleDescription(/3\s*篇文章/)
    fireEvent.focus(button)
    expect(mocks.chart.dispatchAction).toHaveBeenCalledWith({ type: 'highlight', seriesIndex: 0, dataIndex: 0 })
    expect(mocks.chart.dispatchAction).toHaveBeenCalledWith({ type: 'showTip', seriesIndex: 0, dataIndex: 0 })
    fireEvent.click(button)
    expect(select).toHaveBeenCalledWith('tag')
  })

  it('整团运动只创建一次，交互调整流速，减少动态效果时取消', async () => {
    const animation = { playbackRate: 1, updatePlaybackRate: vi.fn(), cancel: vi.fn() }
    const createAnimation = vi.fn(() => animation)
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: createAnimation })
    try {
      const props = { label: '标签', items: [{ id: 'tag', name: 'MCP', count: 3 }], onSelect: vi.fn() }
      const view = render(<TagCloud {...props} />)
      await waitFor(() => expect(createAnimation).toHaveBeenCalledTimes(1))
      expect(createAnimation).toHaveBeenCalledWith({ offsetDistance: ['0%', '100%'] }, { duration: 24000, iterations: Infinity, easing: 'linear' })
      const root = view.container.firstElementChild!
      fireEvent.pointerEnter(root)
      expect(mocks.animateSpeed).toHaveBeenLastCalledWith(1, 0, expect.objectContaining({ duration: 0.8 }))
      fireEvent.pointerLeave(root)
      expect(mocks.animateSpeed).toHaveBeenLastCalledWith(1, 1, expect.objectContaining({ duration: 0.8 }))
      view.rerender(<TagCloud {...props} selectedId="tag" />)
      expect(createAnimation).toHaveBeenCalledTimes(1)
      vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
      view.rerender(<TagCloud {...props} selectedId="tag" />)
      expect(animation.cancel).toHaveBeenCalledTimes(1)
      view.unmount()
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    }
  })
})
