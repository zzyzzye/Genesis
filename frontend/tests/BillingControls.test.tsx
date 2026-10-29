import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { WalletPage } from '../src/features/billing/WalletPage'

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear() })
it('零余额钱包展示真实空态，充值说明留在账务流程内', async () => {
  localStorage.setItem('genesis-account-token','synthetic-test-token')
  vi.spyOn(globalThis,'fetch').mockImplementation(async input => {
    await Promise.resolve()
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    if(url.endsWith('/auth/me')) return new Response(JSON.stringify({ id:'member',role:'member' }))
    if(url.endsWith('/billing/wallet')) return new Response(JSON.stringify({ available:'0.00000000',frozen:'0.00000000' }))
    return new Response(JSON.stringify({ items:[],total:0 }))
  })
  render(<MemoryRouter><WalletPage /></MemoryRouter>)
  expect(await screen.findByText('暂无生成账单。')).toBeVisible()
  expect(screen.getAllByText('¥0.00')).toHaveLength(1)
  expect(screen.queryByRole('link', { name:/SVG/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name:'查看充值说明' }))
  expect(await screen.findByRole('dialog')).toHaveTextContent('站长人工充值')
  expect(screen.getByRole('dialog')).toHaveTextContent('余额流水')
})

it('人工入账响应未知后刷新，继续确认沿用原操作标识且不自动入账', async () => {
  localStorage.setItem('genesis-account-token','synthetic-test-token')
  const requests: string[] = []
  vi.spyOn(globalThis,'fetch').mockImplementation(async (input, init) => {
    await Promise.resolve()
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body),{status})
    if(url.endsWith('/auth/me')) return reply({ id:'owner',role:'owner' })
    if(url.includes('/admin/billing/users')) return reply([{ id:'member',handle:'synthetic',display_name:'合成账户',available:'0',frozen:'0' }])
    if(url.endsWith('/billing/wallet')) return reply({ available:'0',frozen:'0' })
    if(url.endsWith('/admin/billing/policies')) return reply([])
    if(url.endsWith('/admin/billing/credits')) {
      requests.push(typeof init?.body === 'string' ? init.body : '')
      if(requests.length === 1) throw new Error('合成网络中断')
      return reply({ available:'1',frozen:'0' },201)
    }
    return reply({ items:[],total:0 })
  })
  const first = render(<MemoryRouter><WalletPage admin /></MemoryRouter>)
  fireEvent.change(await screen.findByLabelText('搜索账号'),{target:{value:'synthetic'}})
  fireEvent.click(await screen.findByRole('button',{name:'@synthetic · ¥0.00'}))
  fireEvent.change(screen.getByLabelText('入账金额（负数为更正）'),{target:{value:'1'}})
  fireEvent.change(screen.getByLabelText('入账原因'),{target:{value:'合成核对'}})
  fireEvent.click(screen.getByText('核对入账信息'))
  fireEvent.click(await screen.findByRole('button',{name:'确认入账'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('操作标识保持不变')
  first.unmount()
  render(<MemoryRouter><WalletPage admin /></MemoryRouter>)
  await screen.findByRole('dialog')
  expect(requests).toHaveLength(1)
  fireEvent.click(screen.getByRole('button',{name:'确认入账'}))
  expect(await screen.findByText('账务操作已完成')).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[0]).toBe(requests[1])
})

it('余额流水分区可从地址恢复，分页使用当前分区总数', async () => {
  localStorage.setItem('genesis-account-token','synthetic-test-token')
  vi.spyOn(globalThis,'fetch').mockImplementation(async input => {
    await Promise.resolve()
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    const reply = (body: unknown) => new Response(JSON.stringify(body))
    if (url.endsWith('/auth/me')) return reply({ id:'member',role:'member' })
    if (url.endsWith('/billing/wallet')) return reply({ available:'10.00000001',frozen:'0' })
    if (url.includes('/billing/entries')) return reply({ items:[{ id:'entry',kind:'credit',amount:'0.00000001',frozen_delta:'0',reason:'微小金额精度验证',created_at:'2026-10-26T00:00:00Z' }],total:25 })
    return reply({ items:[],total:0 })
  })
  render(<MemoryRouter initialEntries={['/account/wallet?tab=entries&page=2']}><WalletPage /></MemoryRouter>)
  expect(await screen.findByText('+¥0.00000001')).toBeVisible()
  expect(screen.getByRole('link',{ name:'余额流水，共 25 条' })).toHaveAttribute('aria-current','page')
  expect(screen.getByRole('button',{ name:'上一页' })).toBeEnabled()
  expect(screen.getByRole('button',{ name:'下一页' })).toBeDisabled()
  fireEvent.click(screen.getByRole('link',{ name:'创作账单，共 0 条' }))
  expect(await screen.findByText('暂无生成账单。')).toBeVisible()
  expect(screen.queryByText('微小金额精度验证')).not.toBeInTheDocument()
})

it('读取失败显示恢复入口，不同时展示空账单或零余额', async () => {
  localStorage.setItem('genesis-account-token','synthetic-test-token')
  vi.spyOn(globalThis,'fetch').mockImplementation(async input => {
    await Promise.resolve()
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    return url.endsWith('/auth/me') ? new Response(JSON.stringify({ id:'member',role:'member' })) : new Response(JSON.stringify({ detail:'合成服务错误' }),{ status:503 })
  })
  render(<MemoryRouter><WalletPage /></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('账务暂时无法读取')
  expect(screen.queryByText('暂无生成账单。')).not.toBeInTheDocument()
  expect(screen.queryByText('¥0.00')).not.toBeInTheDocument()
  expect(screen.getByRole('button',{ name:'重新读取' })).toBeEnabled()
})
