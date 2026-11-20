import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LoaderCircle } from 'lucide-react'
import type { AiGenerationMetrics } from '../../lib/api'
import { useModalDialog } from '../../studio/useModalDialog'
import { amountLabel, billingApi, type BillingOperation } from './api'

type Charge = { id?: string; created_at?: string; request_id: string | null; status: string; amount: string; details: Record<string, unknown> }
export type BillingDetail = BillingOperation & {
  created_at?: string
  call_count?: number
  generation_status?: string | null
  generation_metrics?: AiGenerationMetrics | null
  calls: Charge[]
}
type Fact = { label: string; value: string }
const kinds: Record<string, string> = { agent:'AI 对话',image:'图片生成',video:'视频生成' }
const statuses: Record<string, string> = { settled:'已结算',review:'需核对',running:'处理中',pending:'待结算',quoted:'尚未开始' }
const runStatuses: Record<string, string> = { pending:'等待生成',running:'生成中',completed:'已完成',failed:'生成失败',cancelled:'已取消' }

function valueOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : null
}
function nested(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
}
function dateLabel(value?: string): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null
  return new Date(value).toLocaleString('zh-CN', { hour12:false })
}
function facts(values: [string, unknown][]): Fact[] {
  return values.flatMap(([label, raw]) => { const value = valueOf(raw); return value === null ? [] : [{ label,value }] })
}
function FactList({ items }: { items: Fact[] }) {
  return <dl className="charge-facts">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
}
function callFacts(call: Charge): Fact[] {
  const details = call.details
  return facts([
    ['上游请求 ID',call.request_id], ['输入 Token',details.prompt_tokens], ['输出 Token',details.completion_tokens],
    ['缓存读取 Token',details.cache_tokens], ['计费阶梯',details.matched_tier],
    ['结算额度',nested(details.billing_formula,'final_quota')], ['实际分组倍率',nested(details.billing_formula,'effective_group_ratio')],
    ['请求模型',nested(details.response_model,'requested_model')], ['上游模型',nested(details.response_model,'upstream_model')],
    ['返回模型',nested(details.response_model,'returned_model')],
  ])
}
function metricFacts(metrics: AiGenerationMetrics): Fact[] {
  const seconds = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)} 秒` : null
  return facts([
    ['最近一次调用输入 Token',metrics.input_tokens],
    [metrics.token_source === 'estimated' ? '正文输出 Token（估算）' : '正文输出 Token',metrics.output_tokens],
    ['首次输出耗时',seconds(metrics.first_token_seconds)], ['生成耗时',seconds(metrics.total_seconds)],
    ['正文输出速度',typeof metrics.tokens_per_second === 'number' ? `${metrics.tokens_per_second.toFixed(1)} Token/秒` : null],
    ['输入统计对应模型',metrics.input_model],
  ])
}

export function ChargeDialog({ id, admin, close }: { id: string; admin: boolean; close: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  const dialog = useModalDialog(cancel)
  const [data, setData] = useState<BillingDetail | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void billingApi<BillingDetail>(`${admin ? '/admin' : ''}/billing/operations/${id}`, 'GET', undefined, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setData(result); setError('') } })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [id, admin, attempt])
  return <dialog ref={dialog} className="billing-dialog billing-dialog--account charge-dialog" aria-labelledby="billing-details-title" onCancel={close}>
    <header className="charge-dialog-heading"><h2 id="billing-details-title">费用明细</h2><span>{data ? kinds[data.kind] ?? data.kind : '账单详情'}</span></header>
    <div className="charge-dialog-body">
      {error ? <div className="charge-dialog-message" role="alert"><p>明细暂时无法读取</p><p>{error}</p><button type="button" onClick={() => { setError(''); setAttempt(n => n+1) }}>重新读取明细</button></div> : !data ? <div className="charge-dialog-message" role="status"><LoaderCircle className="account-submit-spinner" size={22} aria-hidden="true" /><p>正在读取明细…</p></div> : <>
        <section className="charge-summary" aria-label="费用摘要">
          <div><h3>{data.model}</h3><p>{data.mode === 'free' ? '本次免费，不扣钱包余额' : data.mode === 'platform' ? '本次费用由站点承担' : '钱包实际扣款'}</p></div>
          <strong>{data.mode === 'free' ? '免费' : data.mode === 'platform' ? '站点承担' : data.status === 'settled' ? amountLabel(data.charged_amount) : '待结算'}</strong>
        </section>
        <FactList items={facts([
          ['创建时间',dateLabel(data.created_at)], ['模型渠道',data.provider === 'mimo' ? 'MiMo' : data.provider],
          ['账单状态',statuses[data.status] ?? data.status], ['调用次数',`${data.call_count ?? data.calls.length} 次`],
          ['生成状态',data.generation_status ? runStatuses[data.generation_status] ?? data.generation_status : null], ['账单编号',data.id],
        ])} />
        {data.note && <p className="charge-note">{data.note}</p>}
        <section className="charge-section" aria-labelledby="charge-metrics-title">
          <h3 id="charge-metrics-title">生成统计</h3>
          {data.generation_metrics ? <><FactList items={metricFacts(data.generation_metrics)} /><p className="charge-note">输入仅统计最近一次模型调用；输出为正文用量，不作为整轮计费依据。</p></> : <p className="charge-note">{data.kind === 'agent' ? `此记录没有保存任务级生成统计。${data.calls.length ? '已记录的调用用量可在下方展开查看。' : ''}` : '此类任务不提供文本 Token 统计，请查看下方调用记录。'}</p>}
        </section>
        <section className="charge-section" aria-labelledby="charge-calls-title">
          <div className="charge-section-heading"><h3 id="charge-calls-title">调用记录</h3><span>{data.calls.length} 条</span></div>
          {data.calls.length ? data.calls.map((call,index) => {
            const items = callFacts(call)
            return <details className="charge-call" key={call.id ?? index}>
              <summary><span><strong>调用 {String(index+1).padStart(2,'0')}</strong><small>{dateLabel(call.created_at) ?? '未记录调用时间'}</small></span><span className="charge-call-amount">{data.mode === 'free' ? '免费' : call.status === 'settled' ? amountLabel(call.amount) : '待核对'}</span><ChevronDown size={16} aria-hidden="true" /></summary>
              {items.length ? <FactList items={items} /> : <p className="charge-note">此调用未保存请求标识和用量明细。</p>}
              {!call.request_id && items.length > 0 && <p className="charge-note">此调用未记录上游请求 ID。</p>}
            </details>
          }) : <p className="charge-note">暂无上游请求记录。</p>}
        </section>
      </>}
    </div>
    <footer><button ref={cancel} type="button" onClick={close}>关闭明细</button></footer>
  </dialog>
}
