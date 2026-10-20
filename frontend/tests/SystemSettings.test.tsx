import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { SystemSettings } from '../src/studio/SystemSettings'
import { cursorPreferenceKey } from '../src/features/cursor/preferences'

afterEach(() => { cleanup(); localStorage.removeItem(cursorPreferenceKey) })
function Harness() {
  const location = useLocation()
  return <><output aria-label="当前地址">{location.pathname}</output><SystemSettings /></>
}
describe('系统设置层级', () => {
  it('总览展示实际设置入口，不直接展开光标设置', () => {
    render(<MemoryRouter initialEntries={['/blog/studio/settings']}><Harness /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '设置总览' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '光标外观' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /账户资料/ }).every(link => link.getAttribute('href') === '/account')).toBe(true)
    fireEvent.click(screen.getByRole('link', { name: /外观与交互.*选择光标/ }))
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('/blog/studio/settings/appearance')
    expect(screen.getByRole('heading', { name: '光标外观' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '系统设置' }))
    expect(screen.getByRole('heading', { name: '设置总览' })).toBeInTheDocument()
  })
  it('外观深链接可直接打开，返回总览保留已选偏好', () => {
    render(<MemoryRouter initialEntries={['/blog/studio/settings/appearance']}><Harness /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /龙鳞箭头/ }))
    fireEvent.click(screen.getByRole('link', { name: '设置总览' }))
    expect(screen.getByRole('link', { name: /外观与交互.*选择光标/ })).toHaveTextContent('龙鳞箭头')
    expect(screen.getByRole('link', { name: '设置总览' })).toHaveAttribute('aria-current', 'page')
  })
  it('未知设置子路径提供返回入口', () => {
    render(<MemoryRouter initialEntries={['/blog/studio/settings/missing']}><Harness /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '未找到这个设置页面' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '返回设置总览' }))
    expect(screen.getByRole('heading', { name: '设置总览' })).toBeInTheDocument()
  })
})
