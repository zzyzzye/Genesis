import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Account } from '../src/Account'
import { getCurrentUser, login, registerAccount, updateCurrentUser } from '../src/lib/api'
import { getStoredAuthToken, storeAuthToken } from '../src/lib/auth'

vi.mock('../src/lib/api', () => ({ getCurrentUser: vi.fn(), login: vi.fn(), registerAccount: vi.fn(), updateCurrentUser: vi.fn() }))
const user = { id: 'account-ui-reader', handle: 'reader', display_name: '测试读者', bio: '', avatar_url: null, role: 'member' }
type AccessToken = Awaited<ReturnType<typeof login>>
const session: AccessToken = { access_token: 'account-ui-test-session', token_type: 'bearer' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function setup(path = '/account') {
  const router = createMemoryRouter([
    { path: '/account', element: <Account /> },
    { path: '*', element: <p>已回到原页面</p> },
  ], { initialEntries: [path] })
  const view = render(<RouterProvider router={router} />)
  return { ...view, router }
}
function fillLogin() {
  fireEvent.change(screen.getByRole('textbox', { name: '账号' }), { target: { value: 'reader' } })
  fireEvent.change(screen.getByLabelText('密码', { exact: true }), { target: { value: 'test-password' } })
}
function submit() { fireEvent.submit(screen.getByRole('form')) }

describe('账户登录与注册', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(login).mockResolvedValue(session)
    vi.mocked(getCurrentUser).mockResolvedValue(user)
    vi.mocked(registerAccount).mockResolvedValue(user)
    vi.mocked(updateCurrentUser).mockResolvedValue(user)
  })
  afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks() })

  it('选图预览后随资料保存，失败可重试，成功不重复上传', async () => {
    storeAuthToken(session.access_token)
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:avatar-test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const saved = { ...user, avatar_url: '/api/v1/auth/avatars/test.png' }
    vi.mocked(updateCurrentUser).mockRejectedValueOnce(new Error('测试失败')).mockResolvedValue(saved)
    setup()
    await screen.findByRole('heading', { name: user.display_name })
    const file = new File(['image'], '头像.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('选择头像图片'), { target: { files: [file] } })
    expect(create).toHaveBeenCalledWith(file)
    expect(screen.getByText('已选图片，保存资料后生效。')).toBeInTheDocument()
    const form = screen.getByRole('form', { name: '个人资料' })
    fireEvent.submit(form)
    await screen.findByText('保存失败，输入已保留，请稍后重试。')
    expect(screen.getByText('已选图片，保存资料后生效。')).toBeInTheDocument()
    fireEvent.submit(form)
    await screen.findByText('个人资料已保存。')
    expect(updateCurrentUser).toHaveBeenLastCalledWith(session.access_token, { display_name: user.display_name, bio: '', avatar_url: null }, file)
    await waitFor(() => expect(screen.getByLabelText('头像地址')).toHaveValue(saved.avatar_url))
    expect(revoke).toHaveBeenCalledWith('blob:avatar-test')
    fireEvent.submit(form)
    await waitFor(() => expect(updateCurrentUser).toHaveBeenLastCalledWith(session.access_token, { display_name: user.display_name, bio: '', avatar_url: saved.avatar_url }))
    create.mockRestore(); revoke.mockRestore()
  })

  it('拒绝不支持或过大的头像，取消选择恢复原头像', async () => {
    storeAuthToken(session.access_token)
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:avatar-test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    setup()
    await screen.findByRole('heading', { name: user.display_name })
    const input = screen.getByLabelText('选择头像图片')
    fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('请选择 PNG')
    const large = new File(['x'], 'a.png', { type: 'image/png' })
    Object.defineProperty(large, 'size', { value: 6 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [large] } })
    expect(screen.getByRole('alert')).toHaveTextContent('5 MiB')
    fireEvent.change(input, { target: { files: [new File(['image'], 'a.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }))
    expect(screen.queryByText('已选图片，保存资料后生效。')).not.toBeInTheDocument()
    expect(revoke).toHaveBeenCalledWith('blob:avatar-test')
    expect(updateCurrentUser).not.toHaveBeenCalled()
    create.mockRestore(); revoke.mockRestore()
  })

  it('暂时无法读取时保留凭据并允许重试，续期后不丢失正在编辑的资料', async () => {
    storeAuthToken(session.access_token)
    vi.mocked(getCurrentUser).mockRejectedValueOnce(new TypeError('测试网络失败'))
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('账户暂时无法读取')
    expect(getStoredAuthToken()).toBe(session.access_token)
    fireEvent.click(screen.getByRole('button', { name:'重试' }))
    await screen.findByRole('heading', { name:user.display_name })
    const name = screen.getByRole('textbox', { name:'昵称' })
    fireEvent.change(name, { target:{ value:'尚未保存的昵称' } })
    vi.mocked(getCurrentUser).mockRejectedValueOnce(new Error('测试续期服务不可用'))
    act(() => storeAuthToken('account-ui-renewed-session'))
    expect(await screen.findByText('账户暂时无法读取，请稍后重试。')).toBeInTheDocument()
    expect(name).toHaveValue('尚未保存的昵称')
    expect(getStoredAuthToken()).toBe('account-ui-renewed-session')
  })

  it('资料保留返回首页，仅作者可进入写作台，头像加载失败后显示首字', async () => {
    storeAuthToken(session.access_token)
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ ...user, role: 'owner', avatar_url: '/missing-avatar.jpg' })
    const view = setup()
    await screen.findByRole('heading', { name: user.display_name })
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: '写作台' })).toHaveAttribute('href', '/blog/studio')
    const avatar = view.container.querySelector('.account-avatar')!
    fireEvent.error(avatar.querySelector('img')!)
    expect(avatar.querySelector('img')).toBeNull()
    expect(avatar).toHaveTextContent('测')
    view.unmount()
    setup()
    await screen.findByRole('heading', { name: user.display_name })
    expect(screen.queryByRole('link', { name: '写作台' })).not.toBeInTheDocument()
  })

  it('资料使用关联错误与首错聚焦，保存防重且失败保留输入', async () => {
    storeAuthToken(session.access_token)
    setup()
    await screen.findByRole('heading', { name: user.display_name })
    const form = screen.getByRole('form', { name: '个人资料' })
    const name = screen.getByRole('textbox', { name: '昵称' })
    const avatar = screen.getByRole('textbox', { name: '头像地址' })
    expect(form).toHaveAttribute('novalidate')
    fireEvent.change(name, { target: { value: ' ' } })
    fireEvent.submit(form)
    expect(name).toHaveFocus()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleName('昵称')
    expect(updateCurrentUser).not.toHaveBeenCalled()
    fireEvent.change(name, { target: { value: ' 修改昵称 ' } })
    fireEvent.change(avatar, { target: { value: '不是网址' } })
    fireEvent.submit(form)
    expect(avatar).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveAttribute('id', avatar.getAttribute('aria-describedby'))
    fireEvent.change(avatar, { target: { value: '' } })
    const pending = deferred<Awaited<ReturnType<typeof updateCurrentUser>>>()
    vi.mocked(updateCurrentUser).mockReturnValueOnce(pending.promise)
    fireEvent.submit(form); fireEvent.submit(form)
    expect(updateCurrentUser).toHaveBeenCalledTimes(1)
    expect(name).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: /正在保存/ })).toBeDisabled()
    await act(async () => { pending.reject(new Error('测试保存失败')); await pending.promise.catch(() => {}) })
    expect(await screen.findByRole('status')).toHaveTextContent('输入已保留')
    expect(name).toHaveValue(' 修改昵称 ')
    fireEvent.submit(form)
    expect(await screen.findByText('个人资料已保存。')).toBeInTheDocument()
    expect(updateCurrentUser).toHaveBeenLastCalledWith(session.access_token, { display_name: '修改昵称', bio: '', avatar_url: null })
  })

  it('空提交由页面校验并聚焦字段，密码可显示和隐藏', () => {
    setup()
    expect(screen.getByRole('form')).toHaveAttribute('novalidate')
    submit()
    const handle = screen.getByRole('textbox', { name: '账号' })
    expect(handle).toHaveFocus()
    expect(handle).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('请输入账号。')).toHaveAttribute('id', handle.getAttribute('aria-describedby'))
    expect(login).not.toHaveBeenCalled()
    fillLogin()
    const password = screen.getByLabelText('密码', { exact: true })
    expect(password).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }))
    expect(password).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: '隐藏密码' }))
    expect(password).toHaveAttribute('type', 'password')
  })

  it('提交时保留表单并阻止重复请求，失败可用原输入重试', async () => {
    const request = deferred<AccessToken>()
    vi.mocked(login).mockReturnValueOnce(request.promise)
    setup(); fillLogin()
    const handle = screen.getByRole('textbox', { name: '账号' })
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }))
    submit(); submit()
    expect(login).toHaveBeenCalledTimes(1)
    expect(handle).toHaveValue('reader')
    expect(handle).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: '正在登录…' })).toBeDisabled()
    expect(screen.getByLabelText('密码', { exact: true })).toHaveAttribute('type', 'password')
    await act(async () => { request.reject(new Error('测试拒绝登录')); await request.promise.catch(() => {}) })
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码错误')
    expect(handle).toBe(screen.getByRole('textbox', { name: '账号' }))
    expect(screen.getByLabelText('密码', { exact: true })).toHaveValue('test-password')
    submit()
    expect(await screen.findByRole('heading', { name: '测试读者' })).toBeInTheDocument()
  })

  it('注册校验与服务端约束一致，成功后沿用登录流程', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '注册账户' }))
    const handle = screen.getByRole('textbox', { name: '账号' })
    fireEvent.change(handle, { target: { value: '_x' } })
    fireEvent.change(screen.getByRole('textbox', { name: '昵称' }), { target: { value: ' ' } })
    fireEvent.change(screen.getByLabelText('密码', { exact: true }), { target: { value: 'short' } })
    submit()
    expect(handle).toHaveFocus()
    expect(screen.getByText(/账号须为 3–50/)).toBeInTheDocument()
    expect(registerAccount).not.toHaveBeenCalled()
    fireEvent.change(handle, { target: { value: ' New_Reader ' } })
    fireEvent.change(screen.getByRole('textbox', { name: '昵称' }), { target: { value: ' 新读者 ' } })
    fireEvent.change(screen.getByLabelText('密码', { exact: true }), { target: { value: 'test-password' } })
    submit()
    await waitFor(() => expect(registerAccount).toHaveBeenCalledWith({ handle: 'New_Reader', display_name: '新读者', password: 'test-password' }))
    expect(await screen.findByRole('heading', { name: '测试读者' })).toBeInTheDocument()
    expect(login).toHaveBeenCalledWith('New_Reader', 'test-password')
  })

  it('注册成功但登录失败时切回登录，重试不会重复创建账户', async () => {
    vi.mocked(login).mockRejectedValueOnce(new TypeError('测试网络失败'))
    setup()
    fireEvent.click(screen.getByRole('button', { name: '注册账户' }))
    fillLogin()
    fireEvent.change(screen.getByRole('textbox', { name: '昵称' }), { target: { value: '新读者' } })
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('账户已创建')
    expect(screen.getByRole('heading', { name: '登录你的账户' })).toBeInTheDocument()
    submit()
    expect(await screen.findByRole('heading', { name: '测试读者' })).toBeInTheDocument()
    expect(registerAccount).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledTimes(2)
  })

  it('登录成功返回受支持的原地址，会话失效时自动聚焦账号', async () => {
    const { router } = setup('/account?reason=expired&returnTo=%2Farticles%2Fexample%23comments')
    expect(screen.getByRole('textbox', { name: '账号' })).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('登录已失效')
    fillLogin(); submit()
    await waitFor(() => expect(router.state.location.pathname).toBe('/articles/example'))
    expect(router.state.location.hash).toBe('#comments')
  })

  it('不跳转外部 returnTo，网络错误提供恢复方向', async () => {
    vi.mocked(login).mockRejectedValueOnce(new TypeError('测试网络失败'))
    const { router } = setup('/account?returnTo=https%3A%2F%2Fexample.com')
    fillLogin(); submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('登录服务暂时不可用')
    submit()
    expect(await screen.findByRole('heading', { name: '测试读者' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/account')
  })

  it('离开页面后忽略迟到的登录响应，不写入会话', async () => {
    const request = deferred<AccessToken>()
    vi.mocked(login).mockReturnValueOnce(request.promise)
    const { unmount } = setup()
    fillLogin(); submit(); unmount()
    await act(async () => { request.resolve(session); await request.promise })
    expect(getStoredAuthToken()).toBeNull()
    expect(getCurrentUser).not.toHaveBeenCalled()
  })

  it('模式切换聚焦账号，输入法组合确认不触发登录', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '注册账户' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '账号' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: '返回登录' }))
    fillLogin()
    const input = screen.getByLabelText('密码', { exact: true })
    fireEvent.compositionStart(input); submit()
    expect(login).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input); submit()
    expect(await screen.findByRole('heading', { name: '测试读者' })).toBeInTheDocument()
  })
})
