import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useModalDialog } from '../../studio/useModalDialog'
import { amountLabel, billingApi, billingLabel, type BillingOperation } from './api'
import './Billing.css'

export function QuoteDialog({ quote, decide }: { quote: BillingOperation; decide: (accepted: boolean) => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  const dialog = useModalDialog(cancel)
  return <dialog ref={dialog} className="billing-dialog" aria-labelledby="billing-quote-title" onCancel={() => decide(false)}>
    <h2 id="billing-quote-title">确认生成预算</h2>
    <p className="billing-model">{quote.model}</p>
    <p>本次最多冻结 <strong>{amountLabel(quote.reserved_amount)}</strong>。</p>
    <p>完成后按上游实际费用结算，未用金额退回可用余额。取消或生成失败后仍会核对已经发出的请求费用。</p>
    <p>报价有效期 5 分钟。自动对话标题由站点承担费用。</p>
    <footer><button ref={cancel} type="button" onClick={() => decide(false)}>取消</button><button type="button" onClick={() => decide(true)}>冻结预算并生成</button></footer>
  </dialog>
}

export function BillingStatus({ initial, token }: { initial: BillingOperation | null | undefined; token?: string }) {
  const [latest, setLatest] = useState<BillingOperation | null>(null)
  const value = latest?.id === initial?.id ? latest : initial
  useEffect(() => {
    if (!initial || initial.mode !== 'paid' || initial.status === 'settled') return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const next = await billingApi<BillingOperation>(`/billing/operations/${initial!.id}`, 'GET', undefined, token, controller.signal)
        if (controller.signal.aborted) return
        setLatest(next)
        if (next.status !== 'settled') timer = setTimeout(() => { void refresh() }, 10000)
      } catch { if (!controller.signal.aborted) timer = setTimeout(() => { void refresh() }, 20000) }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [initial, token])
  return value?.mode === 'paid' ? <p className="billing-status" role="status" title={value.note || undefined}>{billingLabel(value)} <Link to="/account/wallet">查看账单</Link></p> : null
}
