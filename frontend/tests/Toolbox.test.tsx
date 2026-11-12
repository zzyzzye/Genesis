import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ToolboxPage } from '../src/pages/toolbox/ToolboxPage'
import { SvgGenerator } from '../src/pages/toolbox/SvgGenerator'

function setup(path = '/toolbox') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/toolbox" element={<ToolboxPage />} /><Route path="/toolbox/svg" element={<SvgGenerator />} /></Routes></MemoryRouter>)
}

describe('工具箱导航与目录', () => {
  it('恢复 URL 搜索，清空后恢复可用工具并返回输入焦点', () => {
    setup('/toolbox?q=不存在')
    expect(screen.getByRole('heading', { name: '没有找到匹配的工具' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '接下来' })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: '清空搜索' }))
    expect(screen.getByRole('textbox', { name: '搜索工具' })).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'SVG 生成器' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '接下来' })).not.toBeInTheDocument()
    for (const name of ['文本工作台', '开发工具箱', '网页收藏夹']) expect(screen.queryByText(name)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '前往博客' })).toHaveAttribute('href', '/blog')
    expect(screen.getByRole('link', { name: '前往媒体' })).toHaveAttribute('href', '/media')
  })
  it('可折叠侧栏，进入生成器并保留登录返回路径', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }))
    expect(screen.getByRole('button', { name: '展开侧栏' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('link', { name: /打开生成器/ }))
    expect(screen.getByRole('link', { name: /登录后开始生成/ })).toHaveAttribute('href', '/account?returnTo=%2Ftoolbox%2Fsvg')
    expect(screen.getByRole('link', { name: 'SVG 生成器' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '复制 SVG' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下载 SVG' })).toBeDisabled()
  })
  it('手机导航用模态展示并支持取消关闭', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '展开导航' }))
    const dialog = screen.getByRole('dialog', { name: '工具箱导航菜单' })
    expect(within(dialog).getByRole('button', { name: '关闭导航' })).toHaveFocus()
    fireEvent(dialog, new Event('cancel', { bubbles: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
