import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Home } from '../src/pages/home/Home'
import { useLiveReducedMotion } from '../src/lib/motion'

vi.mock('../src/lib/motion', () => ({ useLiveReducedMotion: vi.fn(() => false) }))
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.mocked(useLiveReducedMotion).mockReturnValue(false)
})
afterEach(() => vi.restoreAllMocks())
function setup() { return render(<MemoryRouter><Home /></MemoryRouter>) }

describe('首页门面', () => {
  it('三个空间和账户保持可达', () => {
    setup()
    expect(screen.getByRole('link', { name: '进入博客' })).toHaveAttribute('href', '/blog')
    expect(screen.getByRole('link', { name: '查看工具箱' })).toHaveAttribute('href', '/toolbox')
    expect(screen.getByRole('link', { name: '进入影音' })).toHaveAttribute('href', '/media')
    expect(screen.getByRole('link', { name: '账户' })).toHaveAttribute('href', '/account')
  })

  it('可暂停首页动画，聚焦入口时点亮对应世界', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '暂停首页动画' }))
    expect(screen.getByRole('button', { name: '播放首页动画' })).toBeInTheDocument()
    const portal = screen.getByRole('link', { name: '进入影音' })
    fireEvent.focus(portal)
    expect(portal).toHaveAttribute('data-active', 'true')
    fireEvent.blur(portal)
    expect(portal).toHaveAttribute('data-active', 'false')
  })

  it.each([['进入博客', '/blog'], ['查看工具箱', '/toolbox'], ['进入影音', '/media']])('点击 %s 直接进入对应系统', (name, path) => {
    render(<MemoryRouter><Routes><Route path="/" element={<Home />} /><Route path={path} element={<h1>目标空间</h1>} /></Routes></MemoryRouter>)
    fireEvent.click(screen.getByRole('link', { name }))
    expect(screen.getByRole('heading', { name: '目标空间' })).toBeInTheDocument()
  })

  it('尊重减少动画偏好，也允许用户主动开启并再次暂停', () => {
    vi.mocked(useLiveReducedMotion).mockReturnValue(true)
    setup()
    fireEvent.click(screen.getByRole('button', { name: '开启首页动画' }))
    fireEvent.click(screen.getByRole('button', { name: '暂停首页动画' }))
    expect(screen.getByRole('button', { name: '播放首页动画' })).toBeInTheDocument()
  })

  it('可预览光照并恢复跟随本地时间', () => {
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(12)
    vi.spyOn(Date.prototype, 'getMinutes').mockReturnValue(30)
    setup()
    const slider = screen.getByRole('slider', { name: '预览一天的光照' })
    expect(slider).toHaveAttribute('aria-valuetext', '12:30，白昼')
    fireEvent.change(slider, { target: { value: '0' } })
    expect(slider).toHaveAttribute('aria-valuetext', '00:00，夜晚')
    expect(screen.getByRole('button', { name: '跟随本地时间' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: '跟随本地时间' }))
    expect(slider).toHaveAttribute('aria-valuetext', '12:30，白昼')
    expect(screen.getByRole('button', { name: '跟随本地时间' })).toHaveAttribute('aria-pressed', 'true')
  })
})
