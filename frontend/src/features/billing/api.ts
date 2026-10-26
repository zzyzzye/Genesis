import { request } from '../../lib/api'
import { getStoredAuthToken } from '../../lib/auth'

export type BillingOperation = {
  id: string; kind: string; provider: string; model: string
  mode: 'free' | 'paid' | 'platform'
  status: 'quoted' | 'running' | 'pending' | 'settled' | 'review'
  reserved_amount: string; charged_amount: string; cost_amount: string | null
  currency: 'CNY'; note: string; expires_at: string
}
export type QuoteInput = { kind: 'agent' | 'image' | 'video'; provider?: string; model?: string; project_id?: string; node_id?: string }
export type Wallet = { available: string; frozen: string; currency: string }
export type Page<T> = { items: T[]; total: number }

export function billingApi<T>(path: string, method = 'GET', body?: unknown, token?: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method, signal, headers: {
    Authorization: `Bearer ${token ?? getStoredAuthToken() ?? ''}`,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

export function amountLabel(value: string): string {
  const [whole, fraction = ''] = value.split('.')
  return `¥${whole}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`
}

export function billingLabel(value: BillingOperation): string {
  if (value.mode === 'free') return 'MiMo 免费'
  if (value.mode === 'platform') return value.status === 'settled' ? '费用由站点承担' : '站点成本待核对'
  if (value.status === 'settled') return `已结算 ${amountLabel(value.charged_amount)}`
  if (value.status === 'review') return `需核对 · 冻结 ${amountLabel(value.reserved_amount)}`
  return `待结算 · 冻结 ${amountLabel(value.reserved_amount)}`
}
