import { useEffect, useRef, useState } from 'react'
import { getAttachment, listAttachments, updateAttachment, uploadAttachment, type Attachment, type AttachmentList } from '../lib/attachments'
import { StudioIcon } from './StudioIcon'
import { useModalDialog } from './useModalDialog'
import { AttachmentPreviewContent, AttachmentThumbnail } from './AttachmentPreview'
import './LinksWorkspace.css'
import './EditorAttachmentPicker.css'

export interface EditorAttachmentAccess {
  token: string
  onOpenChange: (open: boolean) => void
  navigation: { blocked: boolean; onCancel: () => void; onConfirm: () => void }
}
interface UploadAttempt { id: string; file: File; folder: string | null }

export function EditorAttachmentPicker({ access, onClose, onInsert }: {
  access: EditorAttachmentAccess; onClose: () => void; onInsert: (item: Attachment) => void
}) {
  const search = useRef<HTMLInputElement>(null)
  const dialog = useModalDialog(search)
  const fileInput = useRef<HTMLInputElement>(null)
  const abortUpload = useRef<AbortController | null>(null)
  const mutation = useRef(false)
  const safeAction = useRef<HTMLButtonElement>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [composing, setComposing] = useState(false)
  const [listing, setListing] = useState<AttachmentList | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState<Attachment | null>(null)
  const [preview, setPreview] = useState<Attachment | null>(null)
  const previewBack = useRef<HTMLButtonElement>(null)
  const [attempt, setAttempt] = useState<UploadAttempt | null>(null)
  const [busy, setBusy] = useState<'upload' | 'publish' | null>(null)
  const [progress, setProgress] = useState(0)
  const [review, setReview] = useState(false)
  const [closing, setClosing] = useState(false)
  const leaving = access.navigation.blocked || closing

  useEffect(() => { if (leaving || review) safeAction.current?.focus() }, [leaving, review])
  useEffect(() => { if (preview && !leaving) previewBack.current?.focus() }, [preview, leaving])

  useEffect(() => () => abortUpload.current?.abort(), [])
  useEffect(() => {
    if (composing) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true); setLoadError('')
      void listAttachments(access.token, folder, query, page, controller.signal).then(data => {
        if (controller.signal.aborted) return
        const lastPage = Math.max(1, Math.ceil(data.total / 20))
        if (page > lastPage) { setPage(lastPage); return }
        setListing(data)
      }).catch(reason => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : '附件列表加载失败，请重试。')
      }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [access.token, folder, query, page, refresh, composing])

  function browse(target: string | null) {
    setFolder(target); setQuery(''); setPage(1); setSelected(null); setError(''); setReview(false); setLoading(true)
  }
  function close() {
    if (mutation.current) return
    if (attempt) setClosing(true)
    else onClose()
  }
  function closePreview() {
    const id = preview?.id
    setPreview(null)
    requestAnimationFrame(() => {
      const trigger = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('[data-preview-id]') ?? [])].find(button => button.dataset.previewId === id)
      trigger?.focus()
    })
  }
  async function upload(value: UploadAttempt) {
    if (mutation.current) return
    mutation.current = true
    setAttempt(value); setBusy('upload'); setProgress(0); setError(''); setSelected(null); setReview(false)
    const controller = new AbortController()
    abortUpload.current = controller
    try {
      const item = await uploadAttachment(access.token, value.id, value.file, value.folder, value.file.name, setProgress, controller.signal)
      setSelected(item); setAttempt(null); setQuery(''); setPage(1); setLoading(true); setRefresh(current => current + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '上传未完成，请重试核对结果。')
    } finally {
      mutation.current = false; abortUpload.current = null; setBusy(null)
    }
  }
  async function insert() {
    if (!selected || mutation.current || attempt) return
    setPreview(null)
    if (!selected.is_public && !review) { setReview(true); setError(''); return }
    mutation.current = true; setBusy('publish'); setError('')
    try {
      // 重取版本，防止另一标签页撤回公开或移动后使用陈旧权限与名称。
      let item = await getAttachment(access.token, selected.id)
      if (!item.is_public && !review) { setSelected(item); setReview(true); return }
      if (!item.is_public) item = await updateAttachment(access.token, item, { name: item.name, parent_id: item.parent_id, is_public: true })
      onInsert(item)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '附件插入失败，请刷新后重试。')
    } finally { mutation.current = false; setBusy(null) }
  }

  return <dialog ref={dialog} className="blog-link-editor editor-attachment-picker" aria-labelledby="editor-attachment-title" onCancel={event => { event.preventDefault(); if (leaving) { access.navigation.onCancel(); setClosing(false) } else if (preview) closePreview(); else close() }}>
    <header><div><h2 id="editor-attachment-title">{leaving ? '离开附件选择？' : review ? '公开附件并插入' : '插入附件'}</h2><p>图片插入正文，其他文件插入下载链接。</p></div><button type="button" aria-label="关闭附件选择" disabled={busy !== null} onClick={() => { if (leaving) { access.navigation.onCancel(); setClosing(false) } else close() }}><StudioIcon name="close" /></button></header>
    {leaving ? <div className="editor-attachment-picker__review">
      {access.navigation.blocked && <p>这会离开写作页。正文中未保存的修改尚未同步到站点，可先返回编辑器保存。</p>}
      <p>{busy ? '操作尚未完成，请等待结果，或先停止上传。' : '已上传的文件会保留在附件库。未插入的选择将丢弃；停止上传后的结果可在附件库核对。'}</p>
      {busy === 'upload' && <button type="button" onClick={() => abortUpload.current?.abort()}>停止上传</button>}
      <footer><button ref={safeAction} type="button" onClick={() => { access.navigation.onCancel(); setClosing(false) }}>继续选择</button><button className="blog-links__primary" type="button" disabled={busy !== null} onClick={() => { onClose(); if (access.navigation.blocked) access.navigation.onConfirm() }}>确认离开</button></footer>
    </div> : <>
      {preview ? <div className="editor-attachment-picker__preview"><button ref={previewBack} type="button" onClick={closePreview}>← 返回附件列表</button><h3>{preview.name}</h3><AttachmentPreviewContent item={preview} token={access.token} /></div> : review && selected ? <div className="editor-attachment-picker__review"><strong>{selected.name}</strong><p>任何拿到链接的人都能访问此附件。即使文章仍是草稿，附件也会立即公开；取消发布文章不会撤回附件。可在附件管理中撤回公开，届时正文图片或链接会失效。</p><p>{selected.image_mime_type ? '将作为正文图片插入。' : '将作为下载链接插入。SVG 等可执行内容只提供下载。'}</p></div> : <>
        <div className="editor-attachment-picker__tools"><label className="blog-links__search"><StudioIcon name="search" /><span className="sr-only">搜索当前文件夹附件</span><input ref={search} maxLength={200} value={query} placeholder="搜索当前文件夹" onChange={event => { setQuery(event.target.value); setPage(1); setLoading(true) }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} /></label><button type="button" disabled={busy !== null || attempt !== null} onClick={() => fileInput.current?.click()}><StudioIcon name="upload" />上传文件</button><input ref={fileInput} type="file" hidden aria-label="上传正文附件" onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''
          if (!file) return
          if (file.size > (listing?.max_upload_bytes ?? 200 * 1024 * 1024)) { setError('单个文件不能超过 200 MiB'); return }
          void upload({ id: crypto.randomUUID(), file, folder })
        }} /></div>
        <nav className="editor-attachment-picker__path" aria-label="附件文件夹"><button type="button" aria-current={folder === null ? 'location' : undefined} disabled={busy !== null || attempt !== null} onClick={() => browse(null)}>全部附件</button>{listing?.breadcrumbs.map(item => <span key={item.id}><span aria-hidden="true">/</span><button type="button" aria-current={folder === item.id ? 'location' : undefined} disabled={busy !== null || attempt !== null} onClick={() => browse(item.id)}>{item.name}</button></span>)}</nav>
        <div className="editor-attachment-picker__list" aria-busy={loading}>
          {loading ? <p role="status">正在加载附件…</p> : loadError ? <div role="alert"><p>{loadError}</p><button type="button" onClick={() => { setLoading(true); setRefresh(value => value + 1) }}>重新加载附件</button></div> : !listing?.items.length ? <div className="editor-attachment-picker__empty"><StudioIcon name="attachment" /><strong>{query ? '没有匹配的附件' : '这个文件夹还没有附件'}</strong><p>{query ? '换个搜索词，或返回其他文件夹。' : '上传文件后即可选中并插入正文。单个文件最多 200 MiB。'}</p></div> : <ul>{listing.items.map(item => <li key={item.id}><div className="editor-attachment-picker__row"><button type="button" disabled={busy !== null || attempt !== null} aria-pressed={item.kind === 'file' ? selected?.id === item.id : undefined} onClick={() => { if (item.kind === 'folder') browse(item.id); else { setSelected(item); setReview(false); setError('') } }}><AttachmentThumbnail item={item} token={access.token} /><span><strong>{item.name}</strong><small>{item.kind === 'folder' ? '文件夹' : `${item.image_mime_type ? '正文图片' : '下载文件'} · ${item.is_public ? '已公开' : '私有'} · ${item.size < 1024 ? `${item.size} B` : `${(item.size / 1024 / 1024).toFixed(2)} MiB`}`}</small></span>{item.kind === 'folder' ? <StudioIcon name="chevron" /> : <span aria-hidden="true">{selected?.id === item.id ? '✓' : ''}</span>}</button>{item.kind === 'file' && <button className="editor-attachment-picker__preview-trigger" data-preview-id={item.id} type="button" aria-label={'预览：' + item.name} disabled={busy !== null || attempt !== null} onClick={() => { setSelected(item); setPreview(item); setReview(false); setError('') }}><StudioIcon name="eye" /></button>}</div></li>)}</ul>}
        </div>
        {!loadError && (listing?.total ?? 0) > 20 && <nav className="editor-attachment-picker__pagination" aria-label="附件选择分页"><button type="button" disabled={loading || busy !== null || page === 1} onClick={() => { setPage(value => value - 1); setLoading(true) }}>上一页</button><span>{page} / {Math.ceil((listing?.total ?? 0) / 20)}</span><button type="button" disabled={loading || busy !== null || page * 20 >= (listing?.total ?? 0)} onClick={() => { setPage(value => value + 1); setLoading(true) }}>下一页</button></nav>}
      </>}
      {attempt && <div className="editor-attachment-picker__upload" role="status"><strong>{attempt.file.name}</strong>{busy === 'upload' ? <><progress value={progress} max={100} aria-label="正文附件上传进度" /><span>{progress === 100 ? '正在保存…' : `正在上传 ${progress}%`}</span><button type="button" onClick={() => abortUpload.current?.abort()}>停止上传</button></> : <><span>尚未确认上传结果</span><button type="button" onClick={() => void upload(attempt)}>重试核对上传</button><button type="button" onClick={() => setClosing(true)}>放弃此次选择</button></>}</div>}
      {error && <p role="alert">{error}</p>}
      <footer><span className="editor-attachment-picker__selection" role="status">{selected ? `已选：${selected.name}` : '选择文件或上传到当前文件夹'}</span><button ref={safeAction} type="button" disabled={busy !== null} onClick={() => { if (review) { setReview(false); setError('') } else close() }}>{review ? '返回选择' : '取消'}</button><button className="blog-links__primary" type="button" disabled={!selected || busy !== null || attempt !== null} onClick={() => void insert()}>{busy === 'publish' ? '正在插入…' : review ? '确认公开并插入' : '插入正文'}</button></footer>
    </>}
  </dialog>
}
