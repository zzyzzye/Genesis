/** 现有 Compose 服务上的独立组件验收，不写入登录状态或发起模型请求。 */
import { useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentModelPicker } from '../../src/features/agent/AgentModelPicker'
import type { AvailableModel, ModelPricePreview } from '../../src/lib/api'
import '../../styles/base.css'
import '../../styles/shared.css'

if (!import.meta.env.DEV || !['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('仅用于本地浏览器验收')
const parameters = new URLSearchParams(location.search)
const state = parameters.get('state')
const light = parameters.get('theme') === 'light'
const pricing: ModelPricePreview = {
  status: 'available', currency: 'CNY', unit: '1M tokens', group: state === 'long' ? '用于检查窄屏折行的很长很长的合成分组名称-codex-pro' : 'codex-pro', group_ratio: '0.2',
  updated_at: '2026-10-27T00:00:00Z', note: '价格仅供核对，实际费用以上游账单为准。',
  tiers: [
    { name: 'short', condition: '上下文 ≤ 272,000 Token', input: '0.4', output: '2.4', cache_read: '0.04', cache_write: '0.5', cache_write_1h: null },
    { name: 'long', condition: '上下文 > 272,000 Token', input: '0.8', output: '3.6', cache_read: '0.08', cache_write: '1', cache_write_1h: null },
  ],
}
const models: AvailableModel[] = [
  { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna', created: null, context_window: 1050000, billing_mode: 'platform', pricing: state === 'missing' ? { ...pricing, status: 'unavailable', tiers: [], note: '价格服务尚未配置，暂无法预览。' } : pricing },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', created: null, context_window: 1000000, billing_mode: 'unavailable', pricing: { ...pricing, group: 'kiro-aws', tiers: [{ name: 'base', condition: null, input: '0.6', output: '3', cache_read: '0.06', cache_write: '0.75', cache_write_1h: '1.2' }] } },
  { id: 'unknown-price', name: '待核对价格的模型', created: null, context_window: null, pricing: { ...pricing, status: 'unavailable', tiers: [], note: '该模型的计价规则暂不能可靠预览，请在上游核对价格。' } },
]
export function Review() {
  const [model, setModel] = useState('gpt-5.6-luna')
  return <main style={{ minHeight: '100dvh', background: light ? '#f5f5f5' : '#161616', color: light ? '#171717' : '#ddd', padding: '24px', fontSize: 13 }}>
    <h1 style={{ fontSize: 18 }}>模型价格预览</h1><p>合成数据 · 不产生真实调用与费用</p>
    <div style={{ position: 'fixed', right: 16, bottom: 36, width: 'min(370px,calc(100vw - 32px))', padding: 14, borderRadius: 12, background: light ? '#fff' : '#303030', '--reasoning-text': light ? '#171717' : '#ddd', '--reasoning-muted': light ? '#686868' : '#999', '--reasoning-hover': light ? '#ededed' : '#393939', '--assistant-paper': light ? '#fff' : '#252525' } as CSSProperties}>
      <AgentModelPicker provider="openai" models={state === 'empty' ? [] : models} model={model} disabled={false} effort={undefined} onProviderChange={() => undefined} onModelChange={setModel} onEffortChange={() => undefined} />
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<Review />)
