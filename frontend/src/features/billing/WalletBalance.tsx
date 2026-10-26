import { useEffect, useState } from 'react'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { amountLabel, billingApi, isWallet, type Wallet } from './api'
import './WalletBalance.css'

export function WalletBalance({ wallet, compact = false }: { wallet: Wallet | null; compact?: boolean }) {
  const amount = wallet ? amountLabel(wallet.available) : '—'
  return <dl className={`wallet-balance${compact ? ' wallet-balance--compact' : ''}`}>
    <div className="wallet-balance-available"><dt>可用余额</dt><dd className={amount.length > 12 ? 'wallet-amount-long' : undefined}>{amount}</dd></div>
    <div className="wallet-balance-frozen"><dt>冻结金额</dt><dd>{wallet ? amountLabel(wallet.frozen) : '—'}</dd><small>任务结算后退回未用金额</small></div>
  </dl>
}

export function WalletPreview({ userId }: { userId: string }) {
  const [result, setResult] = useState<{ userId:string; wallet:Wallet } | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      await Promise.resolve()
      if (controller.signal.aborted) return
      setLoading(true); setFailed(false)
      try {
        const wallet = await billingApi<Wallet>('/billing/wallet', 'GET', undefined, undefined, controller.signal)
        if (!isWallet(wallet)) throw new Error('余额响应无效')
        if (!controller.signal.aborted) setResult({ userId,wallet })
      } catch { if (!controller.signal.aborted) setFailed(true) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [userId, attempt])
  return <aside className="wallet-preview" aria-labelledby="profile-wallet-title">
    <h2 id="profile-wallet-title">创作余额</h2>
    {failed ? <div className="wallet-preview-feedback" role="status"><p>余额暂不可用</p><button type="button" onClick={() => setAttempt(n => n+1)}><RefreshCw size={13} aria-hidden="true" />重新读取余额</button></div> : <>
      <WalletBalance compact wallet={result?.userId === userId && !loading ? result.wallet : null} />
      {loading && <p className="wallet-preview-loading" role="status">正在读取余额…</p>}
    </>}
    <Link className="wallet-preview-link" to="/account/wallet">查看钱包与账单<ArrowUpRight size={16} aria-hidden="true" /></Link>
    <p className="wallet-preview-note">充值、消费与退款记录可在钱包中查看。</p>
  </aside>
}
