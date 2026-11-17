import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaLayout } from '../src/pages/media/MediaLayout'
import { MediaProjects } from '../src/pages/media/MediaProjects'
import { AccountAssetsPage } from '../src/pages/media/ProjectWorkspace'
import * as media from '../src/pages/media/api'

const project = { id: 'one', name: '雨后的城市', version: 1, updated_at: '2026-10-01T08:00:00Z' }

function Workspace() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><MediaLayout>{(create, collection) => location.pathname.endsWith('/assets') ? <AccountAssetsPage /> : <MediaProjects onCreate={create} collection={collection} />}</MediaLayout><button onClick={() => { void navigate(-1) }}>浏览器后退</button><button onClick={() => { void navigate(1) }}>浏览器前进</button><output aria-label="当前位置">{location.pathname}{location.search}{location.hash}</output></>
}

function setup(entry = '/media') {
  vi.spyOn(media, 'api').mockImplementation(path => Promise.resolve(path === '/projects' ? [project] : { items: [], total: 0 }))
  return render(<MemoryRouter initialEntries={[entry]}><Workspace /></MemoryRouter>)
}

describe('影音空间统一导航', () => {
  afterEach(() => vi.restoreAllMocks())

  it('侧栏只保留作品和素材库，切换时复用侧栏与顶栏', async () => {
    const { container } = setup()
    await screen.findByRole('link', { name: '打开作品：雨后的城市' })
    const sidebar = screen.getByRole('complementary', { name: '影音导航' })
    const topbar = container.querySelector('.media-home-topbar')
    const links = within(sidebar).getAllByRole('link')
    expect(within(sidebar).getByRole('link', { name: '作品' })).toHaveAttribute('aria-current', 'page')
    expect(within(sidebar).queryByRole('link', { name: '工作台' })).not.toBeInTheDocument()
    expect(within(sidebar).queryByRole('link', { name: '项目库' })).not.toBeInTheDocument()
    fireEvent.click(within(sidebar).getByRole('link', { name: '素材库' }))
    expect(await screen.findByRole('heading', { name: '素材库', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '影音导航' })).toBe(sidebar)
    expect(container.querySelector('.media-home-topbar')).toBe(topbar)
    expect(within(sidebar).getAllByRole('link')).toEqual(links)
    expect(within(sidebar).getByRole('button', { name: /^镜头搭档/ })).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: '返回 Genesis' })).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: '素材库' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(sidebar).getByRole('link', { name: '作品' }))
    expect(await screen.findByRole('link', { name: '打开作品：雨后的城市' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '影音导航' })).toBe(sidebar)
  })

  it('旧项目库地址替换为作品地址，保留搜索、锚点与前进后退行为', async () => {
    setup('/media?view=projects&q=雨后#works')
    await screen.findByRole('link', { name: '打开作品：雨后的城市' })
    await waitFor(() => expect(screen.getByLabelText('当前位置')).toHaveTextContent('/media?q=%E9%9B%A8%E5%90%8E#works'))
    expect(screen.getByRole('heading', { name: '作品', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '搜索作品' })).toHaveValue('雨后')
    const sidebar = screen.getByRole('complementary', { name: '影音导航' })
    fireEvent.click(within(sidebar).getByRole('link', { name: '素材库' }))
    fireEvent.click(screen.getByRole('button', { name: '浏览器后退' }))
    expect(await screen.findByRole('textbox', { name: '搜索作品' })).toHaveValue('雨后')
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/media?q=%E9%9B%A8%E5%90%8E#works')
    expect(within(sidebar).getByRole('link', { name: '作品' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: '浏览器前进' }))
    expect(await screen.findByRole('heading', { name: '素材库', level: 1 })).toBeInTheDocument()
  })

  it('手机菜单同步合并入口，切换后关闭，素材库仍可新建作品', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '展开导航' }))
    const menu = screen.getByRole('dialog', { name: '影音导航菜单' })
    expect(within(menu).getByRole('link', { name: '作品' })).toBeInTheDocument()
    expect(within(menu).queryByRole('link', { name: '工作台' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('link', { name: '项目库' })).not.toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('link', { name: '素材库' }))
    expect(screen.queryByRole('dialog', { name: '影音导航菜单' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新建作品' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('给作品一个名字')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: '素材库', level: 1 })).toBeInTheDocument()
  })

  it('返回作品时保留已有列表，后台请求未完成也不清空', async () => {
    setup()
    await screen.findByRole('link', { name: '打开作品：雨后的城市' })
    const sidebar = screen.getByRole('complementary', { name: '影音导航' })
    fireEvent.click(within(sidebar).getByRole('link', { name: '素材库' }))
    let finish!: (items: media.Project[]) => void
    vi.mocked(media.api).mockImplementation(path => path === '/projects' ? new Promise<media.Project[]>(resolve => { finish = resolve }) : Promise.resolve({ items: [], total: 0 }))
    fireEvent.click(within(sidebar).getByRole('link', { name: '作品' }))
    expect(screen.getByRole('link', { name: '打开作品：雨后的城市' })).toBeInTheDocument()
    expect(screen.queryByText('正在加载作品…')).not.toBeInTheDocument()
    finish([{ ...project, name: '更新后的作品' }])
    expect(await screen.findByRole('link', { name: '打开作品：更新后的作品' })).toBeInTheDocument()
  })
})
