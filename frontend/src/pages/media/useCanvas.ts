import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Document, defaultVideoFrame, emptyDocument, MediaError, type Snapshot } from './api'
import { normalizeCanvasNodePresets } from './canvasOperations'

function completeDocument(document: Document): Document {
  return { ...document, edges: document.edges ?? [], background: document.background ?? 'dots', frame: document.frame ?? defaultVideoFrame() }
}

function withoutNodeNames(document: Document): string {
  return JSON.stringify({ ...document, nodes: document.nodes.map((node) => ({ ...node, name: undefined })) }, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
}

export function useCanvas(projectId: string, userId: string) {
  const [document, setDocument] = useState<Document>(emptyDocument)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('正在打开…')
  const [conflict, setConflict] = useState(false)
  const [dirty, setDirty] = useState(false)
  const current = useRef(document)
  const version = useRef(0)
  const saved = useRef('')
  const serverBase = useRef<Document>(emptyDocument())
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
    const serverDocument = completeDocument(snapshot.document)
    serverBase.current = serverDocument
    version.current = snapshot.version; saved.current = JSON.stringify(serverDocument)
    let next = serverDocument
    blocked.current = false; setConflict(false)
    if (restoreDraft) {
      try {
        const raw = localStorage.getItem(key)
        const draft = raw ? JSON.parse(raw) as Snapshot : null
        if (draft && Array.isArray(draft.document?.nodes) && draft.document.viewport) {
          next = { ...draft.document, edges: draft.document.edges ?? [], background: draft.document.background ?? 'dots', frame: draft.document.frame ?? defaultVideoFrame() }
          if (draft.version !== snapshot.version && JSON.stringify(next) !== saved.current) { blocked.current = true; setConflict(true) }
        }
      } catch { /* 损坏的本地草稿不会阻止打开服务器版本。 */ }
    } else localStorage.removeItem(key)
    const original = next
    next = normalizeCanvasNodePresets(original)
    const compacted = next !== original
    current.current = next; setDocument(next); history.current = compacted ? [{ ...original, viewport: next.viewport }] : []; future.current = []
    setDirty(JSON.stringify(next) !== saved.current); setReady(true)
    setStatus(blocked.current ? '检测到冲突，已保留本地草稿' : compacted ? '已更新节点，可撤销' : JSON.stringify(next) === saved.current ? '已保存' : original !== serverDocument ? '已恢复本地草稿' : '已打开')
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
        const stored = completeDocument(result.document)
        const names = new Map(stored.nodes.filter(node => node.asset_id && node.name?.trim() && ['image', 'video_asset', 'audio', 'asset'].includes(node.type)).map(node => [node.id, node]))
        const canonical = { ...next, nodes: next.nodes.map(node => {
          const source = names.get(node.id)
          return source && source.asset_id === node.asset_id && source.name !== node.name ? { ...node, name:source.name } : node
        }) }
        version.current = result.version; saved.current = JSON.stringify(canonical); serverBase.current = stored
        const clean = JSON.stringify(current.current) === encoded
        if (clean && canonical.nodes.some((node, index) => node !== next.nodes[index])) { current.current = canonical; setDocument(canonical) }
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
  const syncCanvas = useCallback(async (): Promise<void> => {
    while (pending.current) await pending.current.catch(() => undefined)
    const operation = (async () => {
      const snapshot = await api<Snapshot>(`/projects/${projectId}/canvas`)
      const next = completeDocument(snapshot.document)
      if (snapshot.version < version.current) throw new Error('画布同步版本过期，请重试')
      if (JSON.stringify(current.current) !== saved.current) {
        blocked.current = true; setConflict(true); setStatus('助手已修改画布，已保留本地草稿，请处理冲突')
        throw new Error('画布有未保存修改，未覆盖本地编辑')
      }
      if (JSON.stringify(next) !== saved.current) {
        history.current.push(current.current); history.current = history.current.slice(-60); future.current = []
      }
      version.current = snapshot.version; serverBase.current = next; saved.current = JSON.stringify(next)
      current.current = next; setDocument(next); setDirty(false); blocked.current = false; setConflict(false)
      localStorage.removeItem(key); setStatus('已同步助手修改')
    })()
    pending.current = operation
    try { await operation } finally { if (pending.current === operation) pending.current = null }
  }, [key, projectId])
  const syncNodeNames = useCallback(async (): Promise<void> => {
    // 与已有保存队列串行；409 后仍可核对工具改名，不能自动覆盖其他远端修改。
    while (pending.current) await pending.current.catch(() => undefined)
    const operation = (async () => {
      const snapshot = await api<Snapshot>(`/projects/${projectId}/canvas`)
      if (snapshot.version < version.current) throw new Error('改名同步版本过期，请重试。')
      const serverDocument = completeDocument(snapshot.document)
      if (withoutNodeNames(serverBase.current) !== withoutNodeNames(serverDocument)) {
        blocked.current = true; setConflict(true); setStatus('远端画布还有其他修改，请先处理冲突')
        throw new Error('远端画布还有其他修改，已保留本地草稿。')
      }
      const before = current.current
      const baseline = new Map(serverBase.current.nodes.map((node) => [node.id, node]))
      const remote = new Map(serverDocument.nodes.map((node) => [node.id, node]))
      const nodes = before.nodes.map((node) => {
        const old = baseline.get(node.id), next = remote.get(node.id)
        // 本地后来改名、删除或新增的节点继续以本地意图为准。
        return old && next && node.name === old.name && next.name !== old.name ? { ...node, name: next.name } : node
      })
      const changed = nodes.some((node, index) => node !== before.nodes[index])
      if (changed) { history.current.push(before); history.current = history.current.slice(-60); future.current = [] }
      const next = JSON.stringify(before) === saved.current ? serverDocument : changed ? { ...before, nodes } : before
      version.current = snapshot.version; serverBase.current = serverDocument; saved.current = JSON.stringify(serverDocument)
      current.current = next; setDocument(next === before ? { ...next } : next)
      blocked.current = false; setConflict(false)
      const dirty = JSON.stringify(next) !== saved.current
      setDirty(dirty); setStatus(dirty ? '已同步改名，有待保存本地修改' : '已保存')
      if (dirty) localStorage.setItem(key, JSON.stringify({ version: snapshot.version, document: next }))
      else localStorage.removeItem(key)
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
  return { document, current, ready, status, conflict, apply, save, load, syncNodeNames, syncCanvas, undo, redo, checkpoint }
}
