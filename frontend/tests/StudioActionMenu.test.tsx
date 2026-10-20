import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { StudioActionMenu } from '../src/studio/StudioActionMenu'

afterEach(cleanup)

function mount() {
  const select = vi.fn<(action: string) => void>()
  render(<><StudioActionMenu label="文件操作">{close => <><button role="menuitem" tabIndex={-1} onClick={() => { close(); select('重命名') }}>重命名</button><button role="menuitem" tabIndex={-1} onClick={() => { close(); select('移动') }}>移动</button><button role="menuitem" disabled tabIndex={-1}>不可用</button><button role="menuitem" tabIndex={-1} onClick={() => { close(); select('删除') }}>删除</button></>}</StudioActionMenu><button onClick={() => select('其他操作')}>其他操作</button></>)
  return select
}

it('操作默认隐藏，支持方向键跳过禁用项、首尾导航和 Escape 恢复焦点', () => {
  mount()
  const trigger = screen.getByRole('button', { name: '文件操作' })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  fireEvent.click(trigger)
  const menu = screen.getByRole('menu', { name: '文件操作' })
  expect(within(menu).getByRole('menuitem', { name: '重命名' })).toHaveFocus()
  fireEvent.keyDown(menu, { key: 'ArrowUp' })
  expect(screen.getByRole('menuitem', { name: '删除' })).toHaveFocus()
  fireEvent.keyDown(menu, { key: 'Home' })
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(screen.getByRole('menuitem', { name: '删除' })).toHaveFocus()
  fireEvent.keyDown(menu, { key: 'Escape' })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

it('选择动作先关闭菜单并恢复入口，点击外部不抢走新焦点', () => {
  const select = mount()
  const trigger = screen.getByRole('button', { name: '文件操作' })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
  expect(select).toHaveBeenCalledOnce()
  expect(select).toHaveBeenCalledWith('重命名')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  fireEvent.click(trigger)
  const other = screen.getByRole('button', { name: '其他操作' })
  other.focus()
  fireEvent.pointerDown(other)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(other).toHaveFocus()
})
