import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { useBillingQuote } from '../src/features/billing/useBillingQuote'
import { WalletPage } from '../src/features/billing/WalletPage'

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear() })
const quote = { id:'quote',mode:'paid',model:'test-model',reserved_amount:'0.00800000' }
function QuoteExample({ done }: { done: (value: unknown) => void }) {
  const { confirmQuote, quoteDialog } = useBillingQuote()
  return <><button onClick={() => { void confirmQuote({ kind:'agent',model:'test-model' }).then(done) }}>生成</button>{quoteDialog}</>
}
it('付费报价必须确认，取消不提交生成', async () => {
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(quote),{ status:201 }))
  const done = vi.fn()
  render(<QuoteExample done={done} />)
  fireEvent.click(screen.getByText('生成'))
  expect(await screen.findByRole('dialog')).toHaveTextContent('¥0.008')
  expect(done).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('取消'))
  await waitFor(() => expect(done).toHaveBeenCalledWith(null))
})
it('确认后回传服务端报价标识', async () => {
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(quote),{ status:201 }))
  const done = vi.fn(); render(<QuoteExample done={done} />)
  fireEvent.click(screen.getByText('生成'))
  fireEvent.click(await screen.findByText('冻结预算并生成'))
  await waitFor(() => expect(done).toHaveBeenCalledWith(quote))
})
it('零余额钱包仍提示免费 MiMo 与 SVG，空态不冒充读取失败', async () => {
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
  expect(screen.getByText(/MiMo 与 SVG 免费/)).toBeVisible()
  expect(screen.getAllByText('¥0.00')).toHaveLength(2)
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
