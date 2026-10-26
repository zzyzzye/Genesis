import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { WalletPreview } from '../src/features/billing/WalletBalance'

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })
const wallet = (available = '12.00000001') => new Response(JSON.stringify({ available,frozen:'0.00800000',currency:'CNY' }))

it('读取中不冒充零余额，精确显示八位金额并保留钱包入口', async () => {
  let resolve!: (value:Response) => void
  vi.spyOn(globalThis,'fetch').mockImplementation(() => new Promise<Response>(done => { resolve = done }))
  render(<MemoryRouter><WalletPreview userId="synthetic-user" /></MemoryRouter>)
  await screen.findByText('正在读取余额…')
  expect(screen.queryByText('¥0.00')).not.toBeInTheDocument()
  await waitFor(() => expect(resolve).toBeDefined())
  await act(async () => { resolve(wallet()); await Promise.resolve() })
  expect(await screen.findByText('¥12.00000001')).toBeVisible()
  expect(screen.getByText('¥0.008')).toBeVisible()
  expect(screen.getByRole('link',{ name:'查看钱包与账单' })).toHaveAttribute('href','/account/wallet')
})

it('余额读取失败允许原处重试，不影响编辑资料或显示虚假余额', async () => {
  const fetch = vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('合成网络异常')).mockResolvedValue(wallet())
  render(<MemoryRouter><WalletPreview userId="synthetic-user" /></MemoryRouter>)
  expect(await screen.findByText('余额暂不可用')).toBeVisible()
  expect(screen.queryByText('¥0.00')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{ name:'重新读取余额' }))
  expect(await screen.findByText('¥12.00000001')).toBeVisible()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('切换用户后旧请求迟到也不会覆盖新用户余额', async () => {
  let old!: (value:Response) => void
  vi.spyOn(globalThis,'fetch').mockImplementationOnce(() => new Promise<Response>(done => { old = done })).mockResolvedValue(wallet('28.00'))
  const view = render(<MemoryRouter><WalletPreview userId="old-user" /></MemoryRouter>)
  await waitFor(() => expect(old).toBeDefined())
  view.rerender(<MemoryRouter><WalletPreview userId="new-user" /></MemoryRouter>)
  expect(await screen.findByText('¥28.00')).toBeVisible()
  await act(async () => { old(wallet('999.00')); await Promise.resolve() })
  expect(screen.getByText('¥28.00')).toBeVisible()
  expect(screen.queryByText('¥999.00')).not.toBeInTheDocument()
})

it.each([{}, { available:'NaN',frozen:'0' }, { available:'1',frozen:'0',currency:'USD' }])('异常余额响应不导致资料页崩溃或伪造金额：%j', async body => {
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(body)))
  render(<MemoryRouter><WalletPreview userId="synthetic-user" /></MemoryRouter>)
  expect(await screen.findByText('余额暂不可用')).toBeVisible()
  expect(screen.queryByText('¥0.00')).not.toBeInTheDocument()
})
