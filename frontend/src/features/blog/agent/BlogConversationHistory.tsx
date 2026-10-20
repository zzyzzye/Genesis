import { useEffect, useRef, useState } from 'react'
import { BlogWorkflowDialog } from '../../../studio/BlogWorkflowDialog'
import { conversationIsSelected, type AiConversation, type AiConversationSelection } from '../../../lib/api'
import './BlogConversationHistory.css'

const emptySelection = (): AiConversationSelection => ({ scope: 'selected', ids: [] })

export function BlogConversationHistory({ history, currentId, loading, error, hasMore, disabled, expanded, onReload, onLoadMore, onOpen, onBack, onDelete }: {
  history: AiConversation[]
  currentId: string | null
  loading: boolean
  error: string | null
  hasMore: boolean
  disabled: boolean
  expanded: boolean
  onReload: () => void
  onLoadMore: () => void
  onOpen: (id: string) => void
  onBack: () => void
  onDelete: (selection: AiConversationSelection) => Promise<number>
}) {
  const [selecting, setSelecting] = useState(false)
  const [selection, setSelection] = useState<AiConversationSelection>(emptySelection)
  const [confirmation, setConfirmation] = useState<AiConversationSelection | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const allCheckbox = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLElement>(null)
  const selectedCount = selection.scope === 'selected' ? selection.ids.length : null
  const hasSelection = selection.scope === 'selected' ? selection.ids.length > 0 : hasMore || history.some(item => conversationIsSelected(selection, item.id))
  const blocked = disabled || busy
  const partiallySelected = selection.scope === 'all' ? selection.excluded_ids.length > 0 : selection.ids.length > 0

  useEffect(() => {
    if (allCheckbox.current) allCheckbox.current.indeterminate = partiallySelected
  }, [partiallySelected, selecting])

  function toggle(id: string) {
    setNotice('')
    const values = selection.scope === 'all' ? selection.excluded_ids : selection.ids
    const next = values.includes(id) ? values.filter(value => value !== id) : [...values, id]
    if (next.length > 1000) { setNotice('单次最多逐条选择或排除 1000 段对话，可改用全选。'); return }
    setSelection(selection.scope === 'all' ? { scope: 'all', excluded_ids: next } : { scope: 'selected', ids: next })
  }

  async function remove() {
    if (!confirmation || pending.current) return
    pending.current = true
    setBusy(true)
    setDeleteError(null)
    try {
      const count = await onDelete(confirmation)
      setConfirmation(null)
      setSelecting(false)
      setSelection(emptySelection())
      setNotice(count ? `已删除 ${count} 段历史对话。` : '所选历史对话已不存在，列表已更新。')
      requestAnimationFrame(() => heading.current?.focus())
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : '删除失败，请重试。')
    } finally { pending.current = false; setBusy(false) }
  }

  const scopeDescription = confirmation?.scope === 'all'
    ? `将永久删除全部博客助手历史对话，包括尚未加载的记录${confirmation.excluded_ids.length ? `，保留你已取消勾选的 ${confirmation.excluded_ids.length} 段` : ''}。`
    : `将永久删除所选的 ${confirmation?.ids.length ?? 0} 段历史对话。`

  return <>
    <div className="studio-assistant__history-heading">
      <strong ref={heading} tabIndex={-1}>历史对话</strong>
      <div className="blog-history-actions">
        {!selecting && history.length > 0 && <button type="button" disabled={blocked || loading} onClick={() => { setSelecting(true); setNotice('') }}>批量删除</button>}
        <button type="button" disabled={blocked || loading} onClick={onReload}>刷新</button>
      </div>
    </div>
    {notice && <p className="blog-history-notice" role="status">{notice}</p>}
    {selecting && <div className="blog-history-selection" aria-label="批量管理历史对话">
      <label className="blog-history-check">
        <input ref={allCheckbox} type="checkbox" aria-label="全选全部历史对话" checked={selection.scope === 'all' && !selection.excluded_ids.length} disabled={blocked || loading} onChange={() => setSelection(selection.scope === 'all' && !selection.excluded_ids.length ? emptySelection() : { scope: 'all', excluded_ids: [] })} />
        <span>全选</span>
      </label>
      <span className="blog-history-count">{selection.scope === 'all' ? `全部历史${selection.excluded_ids.length ? `，排除 ${selection.excluded_ids.length} 段` : ''}` : `已选 ${selectedCount} 段`}</span>
      <button type="button" disabled={blocked || loading || !hasSelection || !history.length} onClick={() => { setDeleteError(null); setConfirmation(selection) }}>删除所选</button>
      <button type="button" disabled={busy} onClick={() => { setSelecting(false); setSelection(emptySelection()) }}>取消</button>
      <p>全选包含尚未加载的历史，也可取消勾选保留个别对话。</p>
    </div>}
    {error && <div role="alert"><p>{error}</p><button type="button" disabled={blocked || loading} onClick={onReload}>重试</button></div>}
    {!loading && !error && !history.length && <p className="studio-assistant__history-empty">还没有历史对话。发送第一条消息后，会自动保存在这里。</p>}
    {history.map(item => <div className="blog-history-row" key={item.id}>
      {selecting && <label className="blog-history-check blog-history-row-check"><input type="checkbox" aria-label={`选择对话：${item.title}`} checked={conversationIsSelected(selection, item.id)} disabled={blocked || loading} onChange={() => toggle(item.id)} /></label>}
      <button type="button" className={`studio-assistant__history-item${item.id === currentId ? ' is-selected' : ''}`} aria-current={item.id === currentId ? 'true' : undefined} aria-pressed={selecting ? conversationIsSelected(selection, item.id) : undefined} disabled={blocked || (selecting && loading)} onClick={() => selecting ? toggle(item.id) : onOpen(item.id)}>
        <span>{item.title}</span><small>{new Date(item.updated_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}{item.title_source === 'pending' ? ' · 待命名' : ''}</small>
      </button>
    </div>)}
    {loading && <p role="status">正在读取历史…</p>}
    {hasMore && <button type="button" disabled={blocked || loading} onClick={onLoadMore}>加载更多</button>}
    {!expanded && <button type="button" className="studio-assistant__history-back" disabled={busy} onClick={onBack}>返回当前对话</button>}
    {confirmation && <BlogWorkflowDialog title={confirmation.scope === 'all' && !confirmation.excluded_ids.length ? '删除全部历史对话？' : '删除所选历史对话？'} description={`${scopeDescription}对话与回复无法恢复，正在生成的对话须先停止。此操作不会删除文章，也不会撤销已经执行的操作。`} confirmLabel={busy ? '正在删除…' : '确认删除'} busy={busy} error={deleteError} onConfirm={() => { void remove() }} onCancel={() => { setConfirmation(null); setDeleteError(null) }} />}
  </>
}
