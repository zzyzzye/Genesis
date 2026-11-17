import { useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { api, type Project } from './api'
import { MediaDialog } from './MediaMotion'

export type ProjectAction = { kind: 'create' | 'rename' | 'delete'; project?: Project }

export function ProjectDialog({ action, onClose, onSaved }: { action: ProjectAction; onClose: () => void; onSaved: (project?: Project) => void }) {
  const [name, setName] = useState(action.project?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const deleting = action.kind === 'delete'
  const nameInput = useRef<HTMLInputElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)

  async function submit() {
    if (busy) return
    if (!deleting && !name.trim()) { setError('请输入作品名称。'); return }
    setBusy(true); setError('')
    try {
      const result = action.kind === 'create' ? await api<Project>('/projects', 'POST', { name: name.trim() }) : await api<Project>(`/projects/${action.project!.id}`, deleting ? 'DELETE' : 'PATCH', deleting ? undefined : { name: name.trim() })
      onSaved(result)
    } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }

  return <MediaDialog initialFocus={deleting ? cancel : nameInput} className="media-home-dialog" aria-labelledby="media-home-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <form noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}><header><h2 id="media-home-dialog-title">{deleting ? '删除作品' : action.kind === 'rename' ? '重命名作品' : '给作品一个名字'}</h2><button type="button" aria-label="关闭" disabled={busy} onClick={onClose}><X /></button></header>
      {deleting ? <p>删除“{action.project?.name}”及其专属素材？此操作无法撤销，账户素材库中的素材会保留。</p> : <label>作品名称<input ref={nameInput} readOnly={busy} maxLength={120} value={name} aria-invalid={Boolean(error)} aria-describedby={error ? 'media-home-dialog-error' : undefined} onChange={(event) => setName(event.target.value)} placeholder="例如：雨后的城市" /></label>}
      <div className="media-home-dialog-feedback" aria-live="polite">{error && <p id="media-home-dialog-error" role="alert">{error}</p>}</div><footer><button ref={cancel} type="button" disabled={busy} onClick={onClose}>取消</button><button className={deleting ? 'media-home-danger' : 'media-home-primary'} disabled={busy || (!deleting && !name.trim())} aria-busy={busy}>{busy ? '正在处理…' : deleting ? '删除作品' : action.kind === 'rename' ? '保存名称' : '创建作品'}{!busy && !deleting && <Check />}</button></footer>
    </form>
  </MediaDialog>
}
