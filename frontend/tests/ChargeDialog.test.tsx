import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChargeDialog, type BillingDetail } from '../src/features/billing/ChargeDialog'
import { billingApi } from '../src/features/billing/api'

vi.mock('../src/features/billing/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/features/billing/api')>(),billingApi:vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const bill: BillingDetail = {
  id:'synthetic-bill',kind:'agent',provider:'mimo',model:'mimo-v2.6-pro',mode:'free',status:'settled',
  reserved_amount:'0',charged_amount:'0',cost_amount:null,currency:'CNY',note:'',expires_at:'',
  created_at:'2026-11-20T08:00:00Z',call_count:3,generation_status:'completed',
  calls:Array.from({ length:3 }, (_,index) => ({ id:`call-${index}`,request_id:null,status:'unknown',amount:'0',details:{} })),
}

it('免费多次调用展示摘要和真实缺失原因，不重复堆砌未知或虚构零用量', async () => {
  vi.mocked(billingApi).mockResolvedValue(bill)
  render(<ChargeDialog id={bill.id} admin={false} close={vi.fn()} />)
  await screen.findByText('本次免费，不扣钱包余额')
  expect(screen.getByText('3 次')).toBeVisible()
  expect(screen.getByText('已完成')).toBeVisible()
  expect(screen.queryByText('未知')).not.toBeInTheDocument()
  expect(screen.queryByText('输入 Token')).not.toBeInTheDocument()
  const summaries = document.querySelectorAll('summary')
  expect(summaries).toHaveLength(3)
  fireEvent.click(summaries[0]!)
  expect(screen.getAllByText('此调用未保存请求标识和用量明细。')[0]).toBeVisible()
})

it('任务估算和单次实账分开显示，零 Token 与小数费用完整保留', async () => {
  vi.mocked(billingApi).mockResolvedValue({ ...bill,mode:'paid',charged_amount:'0.00025200',call_count:1,
    generation_metrics:{ input_tokens:0,output_tokens:123,token_source:'estimated',first_token_seconds:0,total_seconds:2.5 },
    calls:[{ id:'call',request_id:'synthetic-request',status:'settled',amount:'0.00025200',details:{ prompt_tokens:0,completion_tokens:0,cache_tokens:0,billing_formula:{ final_quota:126,effective_group_ratio:0.2 },response_model:{ upstream_model:'actual-model' } } }],
  })
  render(<ChargeDialog id={bill.id} admin={false} close={vi.fn()} />)
  await screen.findByText('正文输出 Token（估算）')
  expect(screen.getByText('最近一次调用输入 Token').nextElementSibling).toHaveTextContent('0')
  expect(screen.getByText('首次输出耗时').nextElementSibling).toHaveTextContent('0.00 秒')
  fireEvent.click(document.querySelector('summary')!)
  expect(screen.getByText('输入 Token').nextElementSibling).toHaveTextContent('0')
  expect(screen.getByText('actual-model')).toBeVisible()
  expect(screen.getAllByText('¥0.000252')).toHaveLength(2)
})

it('读取失败可以原处重试，空调用仍提供关闭入口', async () => {
  vi.mocked(billingApi).mockRejectedValueOnce(new Error('合成网络错误')).mockResolvedValueOnce({ ...bill,calls:[],call_count:0 })
  const close = vi.fn()
  render(<ChargeDialog id={bill.id} admin={false} close={close} />)
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name:'重新读取明细' }))
  await screen.findByText('暂无上游请求记录。')
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name:'关闭明细' }))
  expect(close).toHaveBeenCalledOnce()
})
