import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { billingApi, billingLabel, type BillingOperation } from './api'
import './Billing.css'

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
