import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Account } from '../src/Account'
import { getCurrentUser, login, registerAccount } from '../src/lib/api'
import { getStoredAuthToken } from '../src/lib/auth'

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
  })
  afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks() })

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
