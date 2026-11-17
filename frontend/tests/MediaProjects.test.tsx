import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaProjects } from '../src/pages/media/MediaProjects'
import { MediaLayout } from '../src/pages/media/MediaLayout'
import * as media from '../src/pages/media/api'

const projects = [{ id: 'one', name: '雨后的城市', version: 1, updated_at: '2026-10-01T08:00:00Z' }]
const projectResponse = (path: string) => Promise.resolve(path === '/projects' ? projects : { items: [], total: 0 })
function setup() {
  return render(<MemoryRouter initialEntries={['/media']}><Routes><Route path="/media" element={<MediaLayout>{(create, collection) => <MediaProjects onCreate={create} collection={collection} />}</MediaLayout>} /><Route path="/media/projects/:id" element={<p>已打开作品</p>} /></Routes></MemoryRouter>)
}

describe('影音作品列表', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  })
  afterEach(() => vi.restoreAllMocks())
  it('展示真实作品，支持无结果搜索和清空', async () => {
    vi.spyOn(media, 'api').mockImplementation(projectResponse)
    setup()
    expect(await screen.findByRole('link', { name: '打开作品：雨后的城市' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索作品' }), { target: { value: '不存在' } })
    expect(screen.getByText('没有找到匹配的作品')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('textbox', { name: '搜索作品' }).parentElement!.querySelector('button')!)
    expect(screen.getByRole('link', { name: '打开作品：雨后的城市' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '作品', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '查看全部' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('读取封面…')).not.toBeInTheDocument())
  })
  it('空态可新建，失败保留名称，成功打开作品概览', async () => {
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
    expect(await screen.findByText('已打开作品')).toBeInTheDocument()
    expect(request).toHaveBeenLastCalledWith('/projects', 'POST', { name: '我的短片' })
  })
  it('删除前展示确认，取消不发删除请求', async () => {
    const request = vi.spyOn(media, 'api').mockImplementation(projectResponse)
    setup()
    fireEvent.click(await screen.findByRole('button', { name: '管理作品：雨后的城市' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除作品' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('此操作无法撤销')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(request.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false)
  })
  it('加载失败可重试恢复，助手入口发出打开事件', async () => {
    const request = vi.spyOn(media, 'api').mockImplementation(projectResponse).mockRejectedValueOnce(new Error('暂时无法加载'))
    const listener = vi.fn()
    window.addEventListener('genesis:open-media-assistant', listener)
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法加载')
    request.mockResolvedValueOnce(projects)
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => expect(screen.getByRole('link', { name: '打开作品：雨后的城市' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^镜头搭档/ }))
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener('genesis:open-media-assistant', listener)
  })

  it('超过六个作品时仍在统一列表展示，不再区分工作台和项目库', async () => {
    const items = Array.from({ length: 8 }, (_, index) => ({ ...projects[0], id: String(index), name: `作品${index}` }))
    vi.spyOn(media, 'api').mockImplementation(path => Promise.resolve(path === '/projects' ? items : { items: [], total: 0 }))
    setup()
    await screen.findByRole('link', { name: '打开作品：作品7' })
    expect(screen.getAllByRole('link', { name: /^打开作品：/ })).toHaveLength(8)
    expect(screen.queryByRole('link', { name: '工作台' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '项目库' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryAllByText('读取封面…')).toHaveLength(0))
  })

  it('较多作品分批展示，搜索与清空重置展示范围', async () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ ...projects[0], id: String(index), name: `作品${index}` }))
    vi.spyOn(media, 'api').mockImplementation(path => Promise.resolve(path === '/projects' ? items : { items: [], total: 0 }))
    setup()
    fireEvent.click(await screen.findByRole('button', { name: '显示更多作品' }))
    expect(screen.getAllByRole('link', { name: /^打开作品：/ })).toHaveLength(25)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索作品' }), { target: { value: '作品24' } })
    expect(screen.getAllByRole('link', { name: /^打开作品：/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }))
    expect(screen.getAllByRole('link', { name: /^打开作品：/ })).toHaveLength(24)
    expect(screen.getByRole('button', { name: '显示更多作品' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryAllByText('读取封面…')).toHaveLength(0))
  })
})
