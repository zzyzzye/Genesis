import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CursorSettings as SystemSettings } from '../src/studio/CursorSettings'
import { cursorPreferenceKey, readCursorTheme } from '../src/features/cursor/preferences'
import { CursorEffects } from '../src/features/cursor/CursorEffects'

afterEach(() => { cleanup(); localStorage.removeItem(cursorPreferenceKey); vi.restoreAllMocks() })

describe('光标外观偏好', () => {
  it.each([['水晶箭头', 'crystal'], ['黑曜石箭头', 'obsidian'], ['魔法箭头', 'arcane'], ['龙鳞箭头', 'scales'], ['奶油箭头', 'cream']])('箭头皮肤 %s 配套状态可预览与保存', (name, id) => {
    render(<SystemSettings />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
    expect(readCursorTheme()).toBe(id)
    const states = screen.getByLabelText('预览光标状态')
    expect(states.querySelectorAll('button')).toHaveLength(5)
    fireEvent.click(states.querySelector('[data-cursor-state="text"]')!)
    expect(screen.getByAltText(`${name} · 输入状态预览`)).toBeInTheDocument()
    fireEvent.click(states.querySelector('[data-cursor-state="grab"]')!)
    expect(screen.getByAltText(`${name} · 拖拽状态预览`)).toBeInTheDocument()
  })

  it('原生皮肤切换与重置清理全站样式，不创建动画覆盖层', () => {
    localStorage.setItem(cursorPreferenceKey, 'crystal')
    const { unmount } = render(<><SystemSettings /><CursorEffects /></>)
    expect(document.documentElement.dataset.genesisSkin).toBe('crystal')
    expect(document.querySelector('.genesis-cursor')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /奶油箭头/ }))
    expect(document.documentElement.dataset.genesisSkin).toBe('cream')
    fireEvent.click(screen.getByRole('button', { name: /系统默认/ }))
    expect(document.documentElement.dataset.genesisSkin).toBeUndefined()
    unmount()
    expect(document.documentElement.dataset.genesisSkin).toBeUndefined()
  })

  it.each([['魔法羽毛笔', 'quill'], ['星灵', 'starlight'], ['游龙', 'dragon']])('奇幻主题 %s 可保存与恢复', (name, id) => {
    const { unmount } = render(<SystemSettings />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
    expect(readCursorTheme()).toBe(id)
    expect(screen.getByRole('status')).toHaveTextContent(`当前：${name}`)
    unmount()
    render(<SystemSettings />)
    expect(screen.getByRole('button', { name: new RegExp(name) })).toHaveAttribute('aria-pressed', 'true')
  })

  it('默认使用原生光标，未知存储值安全回退', () => {
    localStorage.setItem(cursorPreferenceKey, 'unknown')
    expect(readCursorTheme()).toBe('system')
    render(<SystemSettings />)
    expect(screen.getByRole('button', { name: /系统默认/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByPlaceholderText(/在这里试试中文/)).toHaveValue('')
  })

  it('切换立即保存，重新挂载保留选择，点击与输入独立工作', () => {
    const { unmount } = render(<SystemSettings />)
    fireEvent.click(screen.getByRole('button', { name: /液态融合/ }))
    expect(readCursorTheme()).toBe('gooey')
    expect(screen.getByRole('status')).toHaveTextContent('当前：液态融合')
    fireEvent.click(screen.getByRole('button', { name: /试试点击/ }))
    expect(screen.getByText('已响应 1 次点击')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '中文输入测试' } })
    expect(screen.getByRole('textbox')).toHaveValue('中文输入测试')
    unmount()
    render(<SystemSettings />)
    expect(screen.getByRole('button', { name: /液态融合/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /系统默认/ }))
    expect(readCursorTheme()).toBe('system')
  })

  it('同步其他标签页的变更，清除设置后恢复默认', () => {
    render(<SystemSettings />)
    localStorage.setItem(cursorPreferenceKey, 'lens')
    fireEvent(window, new StorageEvent('storage', { key: cursorPreferenceKey }))
    expect(screen.getByRole('button', { name: /方形透镜/ })).toHaveAttribute('aria-pressed', 'true')
    localStorage.removeItem(cursorPreferenceKey)
    fireEvent(window, new StorageEvent('storage', { key: null }))
    expect(screen.getByRole('button', { name: /系统默认/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('存储失败保持原选择并给出可操作提示', () => {
    render(<SystemSettings />)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    fireEvent.click(screen.getByRole('button', { name: /手绘蜡笔/ }))
    expect(screen.getByRole('status')).toHaveTextContent('检查存储权限后重试')
    expect(screen.getByRole('button', { name: /系统默认/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
