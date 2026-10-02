import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaHome } from '../src/pages/media/MediaHome'
import * as media from '../src/pages/media/api'

const projects = [{ id: 'one', name: '雨后的城市', version: 1, updated_at: '2026-10-01T08:00:00Z' }]
function setup() {
  return render(<MemoryRouter initialEntries={['/media']}><Routes><Route path="/media" element={<MediaHome />} /><Route path="/media/projects/:id/canvas" element={<p>已进入画布</p>} /></Routes></MemoryRouter>)
}

describe('影音首页', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  })
  afterEach(() => vi.restoreAllMocks())
  it('展示真实项目，支持无结果搜索和清空', async () => {
    vi.spyOn(media, 'api').mockResolvedValue(projects)
    setup()
    expect(await screen.findByText('雨后的城市')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索作品' }), { target: { value: '不存在' } })
    expect(screen.getByText('没有找到匹配的项目')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('textbox', { name: '搜索作品' }).parentElement!.querySelector('button')!)
    expect(screen.getByText('雨后的城市')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看全部' }))
    expect(screen.getByRole('heading', { name: /全部项目/ })).toBeInTheDocument()
  })
  it('空态可新建，失败保留名称，成功进入画布', async () => {
    const request = vi.spyOn(media, 'api').mockResolvedValue([])
    setup()
    fireEvent.click(await screen.findByRole('button', { name: '创建第一个作品' }))
    fireEvent.change(screen.getByLabelText('作品名称'), { target: { value: '我的短片' } })
    request.mockRejectedValueOnce(new Error('保存失败，请重试'))
    fireEvent.click(screen.getByRole('button', { name: '创建作品' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败，请重试')
    expect(screen.getByLabelText('作品名称')).toHaveValue('我的短片')
    request.mockResolvedValueOnce(projects[0])
    fireEvent.click(screen.getByRole('button', { name: '创建作品' }))
    expect(await screen.findByText('已进入画布')).toBeInTheDocument()
    expect(request).toHaveBeenLastCalledWith('/projects', 'POST', { name: '我的短片' })
  })
  it('删除前展示确认，取消不发删除请求', async () => {
    const request = vi.spyOn(media, 'api').mockResolvedValue(projects)
    setup()
    fireEvent.click(await screen.findByRole('button', { name: '管理项目：雨后的城市' }))
    fireEvent.click(screen.getByRole('button', { name: '删除项目' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('此操作无法撤销')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('加载失败可重试恢复，助手入口发出打开事件', async () => {
    const request = vi.spyOn(media, 'api').mockRejectedValueOnce(new Error('暂时无法加载'))
    const listener = vi.fn()
    window.addEventListener('genesis:open-media-assistant', listener)
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法加载')
    request.mockResolvedValueOnce(projects)
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => expect(screen.getByText('雨后的城市')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'AI 创作助手' }))
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener('genesis:open-media-assistant', listener)
  })
})
