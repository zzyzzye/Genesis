import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

  it('可暂停光雕并切换形态，不影响空间导航', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '暂停光雕动画' }))
    expect(screen.getByRole('button', { name: '播放光雕动画' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '切换光雕形态' }))
    expect(screen.getByText('星核')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '进入影音' })).toHaveAttribute('href', '/media')
  })
})
