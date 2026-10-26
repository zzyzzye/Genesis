import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, CircleHelp, Film, MessageSquare, RefreshCw, Sparkles } from 'lucide-react'
import { ApiError, getCurrentUser, type CurrentUser } from '../../lib/api'
import { getStoredAuthToken } from '../../lib/auth'
import { useModalDialog } from '../../studio/useModalDialog'
import { amountLabel, billingApi, billingLabel, isWallet, type BillingOperation, type Page, type Wallet } from './api'
import { AccountWorkspace } from '../account/AccountWorkspace'
import { WalletBalance } from './WalletBalance'
import './Billing.css'

type Entry = { id: string; kind: string; amount: string; frozen_delta: string; reason: string; created_at: string }
type Account = Wallet & { id: string; handle: string; display_name: string }
type Policy = { id: string; model: string; kind: string; active: boolean; max_request_amount: string; evidence: string }
type AdminOperation = BillingOperation & { user_id: string }
type Action = { title: string; summary: string; path: string; body: Record<string, unknown> }
type Charge = { request_id: string | null; status: string; amount: string; details: Record<string, unknown> }
const entryKinds: Record<string, string> = { credit:'人工充值',correction:'账务更正',reserve:'预算冻结',settle:'结算与解冻',refund:'供应商退款',review:'人工核对',policy:'价格审核' }
const kindNames: Record<string, string> = { agent:'Agent 对话',image:'图片生成',video:'视频生成' }
function operationStatus(row: BillingOperation): string {
  return row.mode === 'free' ? '免费' : row.mode === 'platform' ? '站点承担' : row.status === 'settled' ? '已结算' : row.status === 'review' ? '需核对' : '待结算'
}
function entryAmount(value: string): string {
  if (/^-?0(?:\.0+)?$/.test(value)) return amountLabel('0')
  return value.startsWith('-') ? `−${amountLabel(value.slice(1))}` : `+${amountLabel(value)}`
}
function entryDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false })
}
function field(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function ChargeDialog({ id, admin, close }: { id: string; admin: boolean; close: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  const dialog = useModalDialog(cancel)
  const [data, setData] = useState<(BillingOperation & { calls:Charge[] }) | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const shown = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '未知'
  const property = (value: unknown, key: string) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
  useEffect(() => {
    const controller = new AbortController()
    void billingApi<BillingOperation & { calls:Charge[] }>(`${admin ? '/admin' : ''}/billing/operations/${id}`, 'GET', undefined, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setData(result); setError('') } })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [id, admin, attempt])
  return <dialog ref={dialog} className="billing-dialog billing-dialog--account" aria-labelledby="billing-details-title" onCancel={close}>
    <h2 id="billing-details-title">费用明细</h2>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setAttempt(n => n+1)}>重试</button></p> : !data ? <p role="status">正在读取明细…</p> : <>
      <p>{data.model} · {billingLabel(data)}</p>{data.note && <p>{data.note}</p>}
      <dl>{data.calls.map((call, index) => <div key={call.request_id ?? index}>
        <dt>请求 ID</dt><dd>{call.request_id ?? '尚未取得网关请求 ID'}</dd>
        <dt>上游费用</dt><dd>{data.mode === 'free' ? '不扣钱包余额' : call.status === 'settled' ? amountLabel(call.amount) : '待核对'}</dd>
        <dt>输入 / 输出 Token</dt><dd>{shown(call.details.prompt_tokens)} / {shown(call.details.completion_tokens)}</dd>
        <dt>缓存读取 / 命中阶梯</dt><dd>{shown(call.details.cache_tokens)} / {shown(call.details.matched_tier)}</dd>
        <dt>结算额度 / 实际分组倍率</dt><dd>{shown(property(call.details.billing_formula, 'final_quota'))} / {shown(property(call.details.billing_formula, 'effective_group_ratio'))}</dd>
        <dt>模型映射</dt><dd>{typeof call.details.response_model === 'object' && call.details.response_model !== null ? shown((call.details.response_model as Record<string, unknown>).upstream_model) : '未知'}</dd>
      </div>)}</dl>
      {!data.calls.length && <p>暂无上游请求记录。</p>}
    </>}
    <footer><button ref={cancel} type="button" onClick={close}>关闭明细</button></footer>
  </dialog>
}

function ConfirmAction({ action, done, cancel }: { action: Action; done: () => void; cancel: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  const dialog = useModalDialog(button)
  const active = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  async function submit() {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try { await billingApi(action.path, 'POST', action.body); done() }
    catch (reason) {
      setUncertain(!(reason instanceof ApiError && reason.status >= 400 && reason.status < 500))
      setError(`${(reason as Error).message}。请使用此处重试，操作标识保持不变。`)
    }
    finally { active.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="billing-dialog billing-dialog--account" aria-labelledby="billing-admin-confirm" onCancel={event => { if (busy || uncertain) event.preventDefault(); else cancel() }}>
    <h2 id="billing-admin-confirm">{action.title}</h2><p>{action.summary}</p>
    {error && <p role="alert">{error}</p>}
    <footer><button ref={button} type="button" disabled={busy || uncertain} onClick={cancel}>取消</button><button type="button" disabled={busy} onClick={() => void submit()}>{busy ? '正在处理…' : error ? '核对并重试此操作' : action.path.endsWith('/policies') ? '启用价格策略' : action.path.endsWith('/resolve') ? '确认结算' : '确认入账'}</button></footer>
  </dialog>
}

function RechargeDialog({ close }: { close: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  const dialog = useModalDialog(button)
  return <dialog ref={dialog} className="billing-dialog billing-dialog--account" aria-labelledby="billing-recharge-title" onCancel={close}>
    <h2 id="billing-recharge-title">如何充值</h2><p>目前支持站长人工充值，暂未开放在线支付。请联系站长确认账号和充值金额，入账后余额会显示在钱包中。</p><p>充值、消费与退款记录可在余额流水中查询。</p>
    <footer><button ref={button} type="button" onClick={close}>知道了</button></footer>
  </dialog>
}

export function WalletPage({ admin = false }: { admin?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const tab = searchParams.get('tab') === 'entries' ? 'entries' : 'usage'
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [entries, setEntries] = useState<Page<Entry>>({ items: [], total: 0 })
  const [operations, setOperations] = useState<Page<AdminOperation>>({ items: [], total: 0 })
  const [policies, setPolicies] = useState<Policy[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [query, setQuery] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selected, setSelected] = useState<Account | null>(null)
  const [searchError, setSearchError] = useState('')
  const [action, setAction] = useState<Action | null>(null)
  const [review, setReview] = useState<AdminOperation | null>(null)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [rechargeOpen, setRechargeOpen] = useState(false)
  useEffect(() => { document.title = admin ? '账务管理 · Genesis' : '我的钱包 · Genesis' }, [admin])
  const token = getStoredAuthToken()
  // 保留操作标识，刷新后仍需人工确认，响应未知时不会另建入账请求。
  useEffect(() => {
    if (!admin || user?.role !== 'owner') return
    const key = `genesis-billing-action:${user.id}`
    let cancelled = false
    try {
      const saved = sessionStorage.getItem(key)
      if (saved) {
        const pending = JSON.parse(saved) as Action
        if (typeof pending.path === 'string' && pending.path.startsWith('/admin/billing/') && typeof pending.body?.request_id === 'string') {
          void Promise.resolve().then(() => { if (!cancelled) setAction(pending) })
        }
      }
    } catch { sessionStorage.removeItem(key) }
    return () => { cancelled = true }
  }, [admin, user?.id, user?.role])
  function openAction(next: Action) {
    if (!user) return
    sessionStorage.setItem(`genesis-billing-action:${user.id}`, JSON.stringify(next))
    setAction(next)
  }
  function clearAction() {
    if (user) sessionStorage.removeItem(`genesis-billing-action:${user.id}`)
    setAction(null)
  }
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    async function load() {
      await Promise.resolve()
      if (controller.signal.aborted) return
      setLoading(true); setError('')
      try {
        const current = await getCurrentUser(token!)
        if (controller.signal.aborted) return
        setUser(current)
        if (admin && current.role !== 'owner') throw new Error('需要站点管理权限')
        const [balance, ledger, tasks] = await Promise.all([
          billingApi<Wallet>('/billing/wallet', 'GET', undefined, token!, controller.signal),
          billingApi<Page<Entry>>(`/billing/entries?page=${page}`, 'GET', undefined, token!, controller.signal),
          billingApi<Page<AdminOperation>>(admin ? `/admin/billing/operations?page=${page}` : `/billing/operations?page=${page}`, 'GET', undefined, token!, controller.signal),
        ])
        if (controller.signal.aborted) return
        if (!isWallet(balance)) throw new Error('余额数据暂不可用，请稍后重试')
        setWallet(balance); setEntries(ledger); setOperations(tasks)
        if (admin) {
          const prices = await billingApi<Policy[]>('/admin/billing/policies', 'GET', undefined, token!, controller.signal)
          if (!controller.signal.aborted) setPolicies(prices)
        }
      } catch (reason) { if (!controller.signal.aborted) setError((reason as Error).message) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [admin, page, refresh, token])
  useEffect(() => {
    if (!admin || user?.role !== 'owner' || !query.trim()) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void billingApi<Account[]>(`/admin/billing/users?q=${encodeURIComponent(query.trim())}`, 'GET', undefined, undefined, controller.signal)
        .then(rows => { if (!controller.signal.aborted) { setAccounts(rows); setSearchError('') } })
        .catch((reason: Error) => { if (!controller.signal.aborted) setSearchError(reason.message) })
    }, 300)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [admin, query, user?.role, refresh])
  function credit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) { setFeedback('请先搜索并选择入账账户'); return }
    const form = new FormData(event.currentTarget)
    const amount = field(form, 'amount'), reason = field(form, 'reason')
    if (!/^-?(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$/.test(amount) || /^-?0(?:\.0+)?$/.test(amount) || !reason) { setFeedback('请填写非零金额（最多八位小数）及入账原因'); return }
    openAction({ title:'确认人工入账',summary:`账户 @${selected.handle}（${selected.display_name}），金额 ${amountLabel(amount)}。备注：${reason}。负数为扣减可用余额的更正。`,
      path:'/admin/billing/credits', body:{ request_id:crypto.randomUUID(),user_id:selected.id,amount,reason } })
  }
  function price(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body: Record<string, unknown> = Object.fromEntries(form)
    if (!body.model || !body.evidence || body.verified !== 'on') { setFeedback('请填写模型、审核依据，并确认费用上限覆盖全部允许参数'); return }
    body.max_input_bytes = Number(body.max_input_bytes); body.max_output_tokens = Number(body.max_output_tokens)
    body.quota_per_cny = Number(body.quota_per_cny); body.verified = true
    body.request_id = crypto.randomUUID()
    openAction({ title:'确认价格审核',summary:`启用 ${field(form, 'model')} 的新审核版本。单个上游请求的最高费用为 ${amountLabel(field(form, 'max_request_amount'))}；Agent 最多八次调用。旧报价将失效。`,path:'/admin/billing/policies',body })
  }
  function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!review) return
    const form = new FormData(event.currentTarget)
    const amount = field(form, 'amount'), reason = field(form, 'reason')
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(amount) || !reason) { setFeedback('请填写已核实的实际费用和核对依据'); return }
    openAction({ title:'确认异常结算', summary:`订单 ${review.id}，已核实上游费用 ${amountLabel(amount)}。超出冻结部分由站点承担。依据：${reason}`,path:`/admin/billing/operations/${review.id}/resolve`,body:{ request_id:crypto.randomUUID(),user_id:review.user_id,amount,reason } })
  }
  const canAdmin = admin && user?.role === 'owner'
  const total = admin || tab === 'usage' ? operations.total : entries.total
  const operationTable = <div className="billing-records"><table className="billing-table billing-table--usage"><caption className="visually-hidden">生成账单</caption><thead><tr><th>创作内容</th><th>状态</th><th className="billing-number">费用</th><th><span className="visually-hidden">操作</span></th></tr></thead><tbody>{operations.items.map(o => {
    const Icon = o.kind === 'image' ? Sparkles : o.kind === 'video' ? Film : MessageSquare
    return <tr key={o.id}><td className="billing-record-name"><div className="billing-record-title"><span className="billing-record-icon"><Icon size={17} strokeWidth={1.5} aria-hidden="true" /></span><div><strong>{o.model}</strong><small>{kindNames[o.kind] ?? o.kind}</small></div></div>{o.note && <p className="billing-record-note">{o.note}</p>}</td><td className="billing-record-status"><span className={`billing-state billing-state--${o.status}`}>{operationStatus(o)}</span></td><td className="billing-number billing-record-amount">{o.mode === 'paid' ? <>{amountLabel(o.status === 'settled' ? o.charged_amount : o.reserved_amount)}{o.status !== 'settled' && <small>已冻结</small>}</> : <span className="billing-dash">—</span>}</td><td className="billing-record-actions"><button type="button" aria-label={`查看 ${o.model} 的费用明细`} onClick={() => setDetailsId(o.id)}>查看明细<ArrowUpRight size={13} aria-hidden="true" /></button>{canAdmin && ['pending','review'].includes(o.status) && <button type="button" onClick={() => setReview(o)}>人工核对</button>}</td></tr>
  })}</tbody></table></div>
  return <AccountWorkspace user={user} active={admin ? 'billing' : 'wallet'}><div className="billing-page">
    <header className="account-workspace-heading"><div><h1>{admin ? '账务管理' : '我的钱包'}</h1><p>{admin ? '管理人工入账、价格审核与待核对的账单。' : '余额、收支与每一次创作的费用。'}</p></div><div className="billing-header-tools">{!admin && <button type="button" onClick={() => setRechargeOpen(true)}><CircleHelp size={15} aria-hidden="true" />充值说明</button>}<button className="billing-icon-button" type="button" aria-label="刷新账务" disabled={loading || !token} onClick={() => setRefresh(n => n+1)}><RefreshCw size={16} aria-hidden="true" /></button></div></header>
    {!token ? <div className="billing-empty"><h2>登录后查看你的钱包</h2><p>余额与账单只对你本人可见。</p><Link to="/account">前往登录<ArrowUpRight size={15} aria-hidden="true" /></Link></div> : <>
      {!admin && <section className="billing-overview" aria-label="钱包概览"><WalletBalance wallet={!loading && !error ? wallet : null} /><aside className="billing-overview-note"><span>余额使用说明</span><p>付费任务先冻结预算，结算后退回差额。</p><p>充值请联系站长，入账后可在余额流水中查看。</p></aside></section>}
      <div className="billing-feedback" aria-live="polite">{loading && <span role="status">正在读取账务…</span>}{feedback && <span role="status">{feedback}</span>}</div>
      {error && <div className="billing-error" role="alert"><h2>账务暂时无法读取</h2><p>{error}</p><button type="button" onClick={() => setRefresh(n => n+1)}><RefreshCw size={14} aria-hidden="true" />重新读取</button></div>}
      {!error && <>
      {canAdmin && <>
        <section className="billing-admin-section"><div className="billing-section-heading"><div><h2>人工入账</h2><p>选择账户，核对金额与入账依据。</p></div></div><label>搜索账号<input value={query} maxLength={100} placeholder="输入账号查找用户" onChange={e => { setQuery(e.target.value); setAccounts([]); setSelected(null) }} /></label>
        {query && <button type="button" onClick={() => { setQuery(''); setAccounts([]); setSelected(null) }}>清空搜索</button>}
        {searchError && <p role="alert">{searchError}</p>}
        <div className="billing-users">{accounts.map(a => <button type="button" key={a.id} aria-pressed={selected?.id === a.id} onClick={() => setSelected(a)}>@{a.handle} · {amountLabel(a.available)}</button>)}</div>
        <form className="billing-form" noValidate onSubmit={credit}><label>入账金额（负数为更正）<input name="amount" inputMode="decimal" placeholder="例如 10.00" /></label><label>入账原因<input name="reason" maxLength={500} placeholder="填写已确认的入账依据" /></label><button className="billing-primary" type="submit" disabled={!selected}>核对入账信息</button></form></section>
        <details className="billing-policy-section"><summary>审核模型费用上限</summary><p>仅填写经供应商核实的最高费用，须涵盖缓存写入、动态阶梯、附加费及所有允许的生成参数。未知模型不能按猜测开放。</p>
          <form className="billing-form" noValidate onSubmit={price}>
            <label>类型<select name="kind"><option value="agent">Agent</option><option value="image">图片</option><option value="video">视频</option></select></label>
            <label>渠道<select name="provider">{['openai','grok','gemini','claude','image','video'].map(p => <option key={p}>{p}</option>)}</select></label>
            <label>精确模型 ID<input name="model" maxLength={255} /></label><label>单个请求最高费用（元）<input name="max_request_amount" inputMode="decimal" /></label>
            <label>请求体最大字节数<input name="max_input_bytes" inputMode="numeric" /></label><label>最大输出 token<input name="max_output_tokens" defaultValue="4096" inputMode="numeric" /></label>
            <label>每元对应额度<input name="quota_per_cny" defaultValue="500000" inputMode="numeric" /></label><label>审核依据<input name="evidence" maxLength={1000} /></label>
            <label className="billing-wide"><span><input type="checkbox" name="verified" /> 已核实此费用上限覆盖模型全部允许参数</span></label><button type="submit">核对价格策略</button>
          </form>
          {policies.length ? <div className="billing-scroll"><table><thead><tr><th>模型</th><th>类型</th><th>单请求上限</th><th>状态</th></tr></thead><tbody>{policies.map(p => <tr key={p.id}><td>{p.model}</td><td>{p.kind}</td><td>{amountLabel(p.max_request_amount)}</td><td>{p.active ? '已启用' : '已暂停 / 旧版本'}</td></tr>)}</tbody></table></div> : <p>尚未审核价格策略。普通用户的付费生成暂不可用。</p>}
        </details>
      </>}
      <section className="billing-history" aria-labelledby="billing-history-title"><div className="billing-section-heading"><h2 id="billing-history-title">{admin ? '生成账单' : '收支与账单'}</h2><span>{loading ? '正在读取记录' : `共 ${total} 条记录`}</span></div>
        {!admin && <nav className="billing-history-tabs" aria-label="账单分类"><Link to="?tab=usage&page=1" aria-label={loading ? '创作账单，正在读取' : `创作账单，共 ${operations.total} 条`} aria-current={tab === 'usage' ? 'page' : undefined}>创作账单<span>{loading ? '—' : operations.total}</span></Link><Link to="?tab=entries&page=1" aria-label={loading ? '余额流水，正在读取' : `余额流水，共 ${entries.total} 条`} aria-current={tab === 'entries' ? 'page' : undefined}>余额流水<span>{loading ? '—' : entries.total}</span></Link></nav>}
        {!loading && (admin || tab === 'usage' ? operations.items.length ? operationTable : <div className="billing-empty"><MessageSquare size={24} strokeWidth={1.3} aria-hidden="true" /><h3>暂无生成账单。</h3><p>每次创作的费用与结算进度都会显示在这里。</p>{!admin && <button type="button" onClick={() => setRechargeOpen(true)}>查看充值说明</button>}</div> : entries.items.length ? <div className="billing-records"><table className="billing-table billing-table--entries"><caption className="visually-hidden">余额流水</caption><thead><tr><th>收支事项</th><th>时间</th><th className="billing-number">可用余额变动</th><th className="billing-number">冻结变动</th></tr></thead><tbody>{entries.items.map(e => <tr key={e.id}><td className="billing-record-name"><div className="billing-record-title"><span className="billing-record-icon"><ArrowDownLeft size={17} aria-hidden="true" /></span><div><strong>{entryKinds[e.kind] ?? e.kind}</strong><small>{e.reason}</small></div></div></td><td className="billing-record-date"><time dateTime={e.created_at} title={new Date(e.created_at).toLocaleString('zh-CN')}>{entryDate(e.created_at)}</time></td><td className="billing-number billing-record-amount">{entryAmount(e.amount)}</td><td className="billing-number billing-record-frozen">{entryAmount(e.frozen_delta)}</td></tr>)}</tbody></table></div> : <div className="billing-empty"><ArrowDownLeft size={24} strokeWidth={1.3} aria-hidden="true" /><h3>暂无余额流水。</h3><p>充值、冻结、结算和退款会逐笔记录在这里。</p></div>)}
        {total > 0 && <div className="billing-pagination"><span>第 {page} 页</span><div><button type="button" aria-label="上一页" disabled={page <= 1 || loading} onClick={() => setSearchParams({ tab,page:String(page-1) })}><ChevronLeft size={16} aria-hidden="true" />上一页</button><button type="button" aria-label="下一页" disabled={page*20 >= total || loading} onClick={() => setSearchParams({ tab,page:String(page+1) })}>下一页<ChevronRight size={16} aria-hidden="true" /></button></div></div>}
      </section>
      {canAdmin && review && <section className="billing-admin-section"><h2>核对订单 {review.id}</h2><form className="billing-form" noValidate onSubmit={resolve}><label>已核实上游费用（元）<input name="amount" inputMode="decimal" /></label><label>核对依据<input name="reason" maxLength={500} /></label><button type="submit">核对结算信息</button><button type="button" onClick={() => setReview(null)}>取消</button></form></section>}
      </>}
    </>}
    {action && <ConfirmAction action={action} cancel={clearAction} done={() => { clearAction(); setReview(null); setFeedback('账务操作已完成'); setRefresh(n => n+1) }} />}
    {detailsId && <ChargeDialog id={detailsId} admin={canAdmin} close={() => setDetailsId(null)} />}
    {rechargeOpen && <RechargeDialog close={() => setRechargeOpen(false)} />}
  </div></AccountWorkspace>
}
