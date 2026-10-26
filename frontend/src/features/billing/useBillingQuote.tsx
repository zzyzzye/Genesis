import { useEffect, useRef, useState } from 'react'
import { billingApi, type BillingOperation, type QuoteInput } from './api'
import { QuoteDialog } from './BillingControls'

export function useBillingQuote() {
  const [pending, setPending] = useState<{ quote: BillingOperation; resolve: (value: BillingOperation | null) => void } | null>(null)
  const active = useRef(false)
  const mounted = useRef(true)
  const resolver = useRef<((value: BillingOperation | null) => void) | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; resolver.current?.(null) } }, [])
  async function confirmQuote(input: QuoteInput, token?: string): Promise<BillingOperation | null> {
    if (active.current) return null
    active.current = true
    try {
      const quote = await billingApi<BillingOperation>('/billing/quotes', 'POST', input, token)
      if (!mounted.current) return null
      if (quote.mode !== 'paid') return quote
      return await new Promise<BillingOperation | null>((resolve) => {
        resolver.current = resolve
        setPending({ quote, resolve })
      })
    } finally { active.current = false }
  }
  function decide(accepted: boolean) {
    pending?.resolve(accepted ? pending.quote : null)
    resolver.current = null
    setPending(null)
  }
  return { confirmQuote, quoteDialog: pending ? <QuoteDialog quote={pending.quote} decide={decide} /> : null }
}
