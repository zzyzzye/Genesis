import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, deleteAdminBlogPage, getAdminBlogPage, saveAdminBlogPage, type BlogPageAdmin, type BlogPageWrite, type BlogPostStatus } from '../lib/api'
import { clearBlogDraft, createEmptyEditor, readBlogDraft, toPayload, writeBlogDraft, type BlogDraft, type EditorState } from './blogEditor'

const base = '/blog/studio/pages'
const newEditor = (): EditorState => { const id = crypto.randomUUID(); return { ...createEmptyEditor(), slug: 'page-' + id, creationId: id } }
const toPageEditor = (page: BlogPageAdmin): EditorState => ({ ...createEmptyEditor(), id: page.id, slug: page.slug, title: page.title, excerpt: page.excerpt, contentMarkdown: page.content_markdown, status: page.status, updatedAt: page.updated_at })

function payload(editor: EditorState, status: BlogPostStatus): BlogPageWrite {
  const data = toPayload(editor, [], status, '页面')
  if (data.content_markdown.length > 200_000) throw new Error('页面正文最多 200000 字符，请缩短后重试。')
  return { slug: data.slug, title: data.title, excerpt: data.excerpt, content_markdown: data.content_markdown, status }
}

export function usePagesWorkspace(token: string, userId: string) {
  const location = useLocation()
  const navigate = useNavigate()
  const active = location.pathname === base || location.pathname.startsWith(base + '/')
  const resource = active ? location.pathname.slice(base.length).split('/').filter(Boolean)[0] : undefined
  const editing = active && location.pathname.endsWith('/edit')
  const [editor, setEditor] = useState(newEditor)
  const [baseline, setBaseline] = useState(editor)
  const [loaded, setLoaded] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [localSaved, setLocalSaved] = useState(true)
  const [recovery, setRecovery] = useState<BlogDraft | null>(null)
  const [confirmation, setConfirmation] = useState<'publish' | 'unpublish' | 'delete' | null>(null)
  const [conflict, setConflict] = useState(false)
  const [comparison, setComparison] = useState<BlogPageAdmin | null>(null)
  const pending = useRef(false)
  const skipLoad = useRef<string | null>(null)
  const listLocation = useRef(base)
  const mounted = useRef(true)
  const bypassNavigation = useRef(false)
  useLayoutEffect(() => { bypassNavigation.current = false; if (!resource) queueMicrotask(() => setLoaded(undefined)) }, [location.pathname, resource])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (active && !resource) listLocation.current = location.pathname + location.search }, [active, resource, location.pathname, location.search])
  useEffect(() => {
    if (!resource) { skipLoad.current = null; return }
    if (skipLoad.current === resource) { skipLoad.current = null; return }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true); setLoadError(''); setFeedback(''); setConfirmation(null); setComparison(null); setConflict(false)
      const load = resource === 'new' ? Promise.resolve(newEditor()) : getAdminBlogPage(token, resource, controller.signal).then(toPageEditor)
      void load.then((next) => {
        if (controller.signal.aborted) return
        setEditor(next); setBaseline(next); setLoaded(resource); setLocalSaved(true)
        const draft = readBlogDraft(userId, next.id, 'page')
        setRecovery(draft && JSON.stringify(draft.editor) !== JSON.stringify(next) ? draft : null)
      }).catch((reason) => { if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : '页面加载失败，请重试。') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [resource, token, userId, reload])
  const ready = Boolean(resource && loaded === resource && !loading && !loadError)
  const dirty = ready && JSON.stringify(editor) !== JSON.stringify(baseline)

  function change(next: EditorState) {
    if (pending.current || recovery) return
    setEditor(next); setLocalSaved(writeBlogDraft(userId, next, 'page')); setFeedback('')
  }
  function restore() {
    if (!recovery) return
    const next = { ...recovery.editor, creationId: recovery.editor.creationId && /^[0-9a-f-]{36}$/.test(recovery.editor.creationId) ? recovery.editor.creationId : editor.creationId }
    setEditor(next); setRecovery(null); setLocalSaved(writeBlogDraft(userId, next, 'page'))
  }
  function discard() { clearBlogDraft(userId, editor.id, 'page'); setRecovery(null) }
  async function save(status: BlogPostStatus) {
    if (pending.current || recovery) return
    let data: BlogPageWrite
    try { data = payload(editor, status) } catch (reason) { setFeedback(reason instanceof Error ? reason.message : '页面内容不完整。'); document.getElementById('markdown-editor-title')?.focus(); return }
    pending.current = true; setBusy(true); setFeedback('')
    try {
      const saved = await saveAdminBlogPage(token, data, editor.id, editor.updatedAt, editor.creationId ?? crypto.randomUUID())
      if (!mounted.current) return
      const next = toPageEditor(saved)
      setEditor(next); setBaseline(next); setLoaded(saved.id); setRecovery(null); setConfirmation(null); setConflict(false)
      clearBlogDraft(userId, editor.id, 'page'); setLocalSaved(true)
      setFeedback(status === 'published' ? '页面已发布到站点。' : editor.status === 'published' ? '已撤回发布，页面保留为草稿。' : '草稿已保存到站点。')
      skipLoad.current = saved.id
      if (location.pathname !== `${base}/${saved.id}/edit`) {
        bypassNavigation.current = true
        void navigate(`${base}/${saved.id}/edit`, { replace: editor.id === null })
      }
    } catch (reason) {
      if (!mounted.current) return
      setFeedback(reason instanceof Error ? reason.message : '未能确认保存结果，内容已保留，请重试。')
      if (reason instanceof ApiError && reason.status === 409 && editor.id) { setConflict(true); setConfirmation(null) }
    } finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  function requestSave(status: BlogPostStatus) {
    if (pending.current || recovery) return
    if (status === 'draft') { void save(status); return }
    try { payload(editor, status); setFeedback(''); setConfirmation('publish') }
    catch (reason) { setFeedback(reason instanceof Error ? reason.message : '请先补充页面内容。'); document.getElementById('markdown-editor-title')?.focus() }
  }
  async function remove() {
    if (!editor.id || !editor.updatedAt || pending.current) return
    pending.current = true; setBusy(true); setFeedback('')
    try {
      await deleteAdminBlogPage(token, editor.id, editor.updatedAt)
      if (!mounted.current) return
      clearBlogDraft(userId, editor.id, 'page'); setBaseline(editor); setLoaded(undefined); setConfirmation(null); setFeedback('页面已删除。')
      bypassNavigation.current = true
      void navigate(listLocation.current)
    } catch (reason) {
      if (mounted.current) {
        setFeedback(reason instanceof Error ? reason.message : '删除失败，请重试。')
        if (reason instanceof ApiError && reason.status === 409) { setConflict(true); setConfirmation(null) }
      }
    } finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  async function compare() {
    if (!editor.id || pending.current) return
    pending.current = true; setBusy(true); setFeedback('')
    try { const latest = await getAdminBlogPage(token, editor.id); if (mounted.current) setComparison(latest) }
    catch (reason) { if (mounted.current) setFeedback(reason instanceof Error ? reason.message : '获取站点版本失败，请重试。') }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  function reconcile(keep: boolean) {
    if (!comparison) return
    const latest = toPageEditor(comparison)
    const next = keep ? { ...editor, updatedAt: latest.updatedAt, status: latest.status } : latest
    setEditor(next); setBaseline(latest); setConflict(false); setComparison(null)
    setLocalSaved(keep ? writeBlogDraft(userId, next, 'page') : true)
    if (!keep) clearBlogDraft(userId, next.id, 'page')
    setFeedback(keep ? '已核对版本，当前修改尚未保存。' : '已采用站点版本。')
  }
  return { active, resource, editing, editor, ready, dirty, busy, loading, loadError, localSaved, recovery, feedback, confirmation, comparison, conflict, bypassNavigation,
    change, restore, discard, save, requestSave, remove, compare, reconcile,
    retry: () => { skipLoad.current = null; setReload(value => value + 1) },
    requestDelete: () => { setFeedback(''); setConfirmation('delete') },
    requestUnpublish: () => { setFeedback(''); setConfirmation('unpublish') },
    cancelConfirmation: () => { if (!pending.current) setConfirmation(null) },
    cancelComparison: () => setComparison(null),
    back: () => void navigate(listLocation.current),
    create: () => void navigate(base + '/new/edit'),
    open: (id: string) => void navigate(base + '/' + encodeURIComponent(id) + '/edit'),
    preview: () => void navigate(base + '/' + (editor.id ?? 'new')),
    edit: () => void navigate(base + '/' + (editor.id ?? 'new') + '/edit'),
  }
}

export type PagesController = ReturnType<typeof usePagesWorkspace>
