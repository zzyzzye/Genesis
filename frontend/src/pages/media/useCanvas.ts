import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Document, emptyDocument, MediaError, type Snapshot } from './api'

export function useCanvas(projectId: string, userId: string) {
  const [document, setDocument] = useState<Document>(emptyDocument)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('正在打开…')
  const [conflict, setConflict] = useState(false)
  const [dirty, setDirty] = useState(false)
  const current = useRef(document)
  const version = useRef(0)
  const saved = useRef('')
  const pending = useRef<Promise<void> | null>(null)
  const blocked = useRef(false)
  const history = useRef<Document[]>([])
  const future = useRef<Document[]>([])
  const key = `genesis-media-draft:${userId}:${projectId}`
  const apply = useCallback((next: Document, record = true) => {
    if (record) { history.current.push(current.current); history.current = history.current.slice(-60); future.current = [] }
    current.current = next; setDocument(next); setDirty(true)
    if (!blocked.current) setStatus('有待保存修改')
    try { localStorage.setItem(key, JSON.stringify({ version: version.current, document: next })) } catch { setStatus('本地暂存不可用，请保持页面打开') }
  }, [key])
  const load = useCallback(async (restoreDraft = false) => {
    const snapshot = await api<Snapshot>(`/projects/${projectId}/canvas`)
    version.current = snapshot.version; saved.current = JSON.stringify(snapshot.document)
    let next = snapshot.document
    blocked.current = false; setConflict(false)
    if (restoreDraft) {
      try {
        const raw = localStorage.getItem(key)
        const draft = raw ? JSON.parse(raw) as Snapshot : null
        if (draft && Array.isArray(draft.document?.nodes) && draft.document.viewport) {
          next = draft.document
          if (draft.version !== snapshot.version && JSON.stringify(next) !== saved.current) { blocked.current = true; setConflict(true) }
        }
      } catch { /* 损坏的本地草稿不会阻止打开服务器版本。 */ }
    } else localStorage.removeItem(key)
    current.current = next; setDocument(next); history.current = []; future.current = []
    setDirty(JSON.stringify(next) !== saved.current); setReady(true)
    setStatus(blocked.current ? '检测到冲突，已保留本地草稿' : JSON.stringify(next) === saved.current ? '已保存' : '已恢复本地草稿')
  }, [key, projectId])
  useEffect(() => { let active = true; void Promise.resolve().then(async () => { if (active) await load(true) }).catch((reason: Error) => { if (active) setStatus(reason.message) }); return () => { active = false } }, [load])
  const save = useCallback(async (): Promise<void> => {
    while (pending.current) await pending.current
    if (blocked.current) throw new Error('请先处理保存冲突')
    const next = current.current
    const encoded = JSON.stringify(next)
    if (encoded === saved.current) return
    setStatus('正在保存…')
    const operation = (async () => {
      try {
        const result = await api<Snapshot>(`/projects/${projectId}/canvas`, 'PUT', { version: version.current, document: next })
        version.current = result.version; saved.current = encoded
        const clean = JSON.stringify(current.current) === encoded
        setDirty(!clean); setStatus(clean ? '已保存' : '有待保存修改')
        if (!clean) setDocument({ ...current.current })
        if (clean) localStorage.removeItem(key)
        else localStorage.setItem(key, JSON.stringify({ version: version.current, document: current.current }))
      } catch (reason) {
        if (reason instanceof MediaError && reason.status === 409) { blocked.current = true; setConflict(true) }
        setStatus(`保存失败：${(reason as Error).message}`); throw reason
      }
    })()
    pending.current = operation
    try { await operation } finally { pending.current = null }
  }, [key, projectId])
  useEffect(() => {
    if (!ready || !dirty || conflict) return
    const timeout = window.setTimeout(() => { void save().catch(() => undefined) }, 700)
    return () => window.clearTimeout(timeout)
  }, [document, ready, dirty, conflict, save])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (JSON.stringify(current.current) !== saved.current) event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  function checkpoint() { history.current.push(current.current); history.current = history.current.slice(-60); future.current = [] }
  function undo() { const previous = history.current.pop(); if (previous) { future.current.push(current.current); apply(previous, false) } }
  function redo() { const next = future.current.pop(); if (next) { history.current.push(current.current); apply(next, false) } }
  return { document, current, ready, status, conflict, apply, save, load, undo, redo, checkpoint }
}
