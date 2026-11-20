import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Home } from '../src/pages/home/Home'

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })
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

  it('可暂停星轨，聚焦入口时点亮对应世界', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '暂停星轨动画' }))
    expect(screen.getByRole('button', { name: '播放星轨动画' })).toBeInTheDocument()
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
})
