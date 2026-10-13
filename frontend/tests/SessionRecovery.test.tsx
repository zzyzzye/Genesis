import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, Routes, Route, useBlocker } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionRecovery } from '../src/SessionRecovery'
import { handleStudioUnauthorized, rememberSessionUser, storeAuthToken } from '../src/lib/auth'
import { getCurrentUser, login } from '../src/lib/api'

vi.mock('../src/lib/api', () => ({ getCurrentUser: vi.fn(), login: vi.fn(), registerAccount: vi.fn(), updateCurrentUser: vi.fn() }))
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks() })
function Draft() {
  const [value, setValue] = useState('')
  useBlocker(Boolean(value))
  return <><input aria-label="未提交内容" value={value} onChange={(event) => setValue(event.target.value)} /><button onClick={() => handleStudioUnauthorized(401, { Authorization: 'Bearer recovery-test-token' })}>模拟失效</button></>
}
function setup() {
  storeAuthToken('recovery-test-token')
  rememberSessionUser('recovery-test-token', 'test-reader')
  vi.mocked(login).mockResolvedValue({ access_token: 'new-test-token', token_type: 'bearer' })
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 'test-reader', handle: 'reader', display_name: '读者', role: 'member', avatar_url: null, bio: '' })
  const router = createMemoryRouter([{ path: '*', element: <SessionRecovery>{(location) => <Routes location={location}><Route path="*" element={<Draft />} /></Routes>}</SessionRecovery> }], { initialEntries: ['/articles/test?view=reading#comments'] })
  render(<RouterProvider router={router} />)
  fireEvent.change(screen.getByRole('textbox', { name: '未提交内容' }), { target: { value: '保留这段输入' } })
  fireEvent.click(screen.getByRole('button', { name: '模拟失效' }))
  return router
}
async function signIn() {
  fireEvent.change(await screen.findByRole('textbox', { name: '账号' }), { target: { value: 'reader' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-password' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '进入 Genesis' })); await Promise.resolve() })
}
describe('统一会话恢复', () => {
  it('弹窗自动跳登录页，重新登录返回完整地址并保留被导航拦截的输入', async () => {
    const router = setup()
    expect(screen.getByRole('dialog', { name: '登录已失效' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即登录' })).toHaveFocus()
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'), { timeout: 4000 })
    expect(new URLSearchParams(router.state.location.search).get('returnTo')).toBe('/articles/test?view=reading#comments')
    expect(screen.queryByRole('textbox', { name: '未提交内容' })).not.toBeInTheDocument()
    await signIn()
    await waitFor(() => expect(router.state.location.pathname).toBe('/articles/test'))
    expect(screen.getByRole('textbox', { name: '未提交内容' })).toHaveValue('保留这段输入')
    expect(router.state.location.hash).toBe('#comments')
  })
  it('并发失效只弹一次，立即登录后密码错误保持登录页，换账号不恢复旧输入', async () => {
    setup()
    handleStudioUnauthorized(401, { Authorization: 'Bearer recovery-test-token' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '立即登录' }))
    vi.mocked(login).mockRejectedValueOnce(new Error('密码错误'))
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码错误')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'different-reader', role: 'reader' } as Awaited<ReturnType<typeof getCurrentUser>>)
    await signIn()
    expect(await screen.findByRole('textbox', { name: '未提交内容' })).toHaveValue('')
  })
})
