import { useRef, useState } from 'react'
import { downloadAttachment } from '../../../lib/attachments'
import { getStoredAuthToken, studioAuthTokenKey } from '../../../lib/auth'
import type { AiAttachment } from '../../../lib/api'
import { StudioIcon } from '../../../studio/StudioIcon'
import type { PendingAttachment } from './useBlogAttachments'
import './BlogAgentAttachments.css'

export function BlogAgentAttachments({ items, disabled, onRetry, onRemove, onStop }: {
  items: PendingAttachment[]; disabled: boolean
  onRetry: (item: PendingAttachment) => void; onRemove: (id: string) => void; onStop: (id: string) => void
}) {
  return <ul className="blog-agent-attachments" aria-label="待发送附件">{items.map(item => <li key={item.id}>
    <StudioIcon name={item.kind === 'video' ? 'media' : item.kind === 'image' ? 'eye' : 'attachment'} />
    <span><strong title={item.name}>{item.name}</strong><small role={item.status === 'failed' ? 'alert' : 'status'}>{item.status === 'uploading' ? item.progress === 100 ? '正在确认上传…' : `上传中 ${item.progress}%` : item.status === 'failed' ? item.error : `${item.size < 1024 ? `${item.size} B` : `${(item.size / 1024).toFixed(0)} KB`} · 已上传`}</small></span>
    {item.status === 'uploading' ? <button type="button" aria-label={`停止上传：${item.name}`} disabled={disabled} onClick={() => onStop(item.id)}>停止</button> : <>
      {item.status === 'failed' && <button type="button" disabled={disabled} aria-label={`重试上传：${item.name}`} onClick={() => onRetry(item)}>重试</button>}
      <button type="button" disabled={disabled} aria-label={`移除附件：${item.name}`} onClick={() => onRemove(item.id)}><StudioIcon name="close" /></button>
    </>}
  </li>)}</ul>
}

export function BlogMessageAttachments({ items }: { items: AiAttachment[] }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const pending = useRef(false)
  async function download(item: AiAttachment) {
    if (pending.current) return
    const token = getStoredAuthToken(studioAuthTokenKey)
    if (!token) { setError('登录已失效，请重新登录。'); return }
    pending.current = true; setBusy(item.id); setError('')
    try {
      await downloadAttachment(token, { ...item, kind: 'file', parent_id: null, is_public: false, created_at: '', updated_at: '' })
    } catch { setError('附件已移除或下载失败，请稍后重试。') }
    finally { pending.current = false; setBusy(null) }
  }
  return <div className="blog-agent-message-files"><ul aria-label="消息附件">{items.map(item => <li key={item.id}><button type="button" disabled={busy !== null} onClick={() => { void download(item) }} title={item.name}><StudioIcon name="attachment" /><span>{busy === item.id ? '正在下载…' : item.name}</span></button></li>)}</ul>{error && <p role="alert">{error}</p>}</div>
}
