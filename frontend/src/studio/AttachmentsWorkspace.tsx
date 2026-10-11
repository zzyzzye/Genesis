import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { attachmentPublicUrl, createAttachmentFolder, deleteAttachment, downloadAttachment, listAttachments, updateAttachment, uploadAttachment, type Attachment, type AttachmentList } from '../lib/attachments'
import { BlogWorkflowDialog } from './BlogWorkflowDialog'
import { StudioIcon } from './StudioIcon'
import { useModalDialog } from './useModalDialog'
import './LinksWorkspace.css'
import './AttachmentsWorkspace.css'

function message(reason: unknown) { return reason instanceof Error ? reason.message : '操作未完成，请稍后重试。' }
function fileSize(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB` }
type Editor = { mode: 'create' | 'rename' | 'move'; item: Attachment | null }
type QueueItem = { id: string; file: File; path: string; parent: string | null; destination: string; state: 'waiting' | 'uploading' | 'done' | 'error' | 'paused'; percent: number; error: string }
type NavigationProps = { navigationBlocked: boolean; onCancelNavigation: () => void; onConfirmNavigation: () => void }

function AttachmentEditor({ editor, token, parent, onClose, onSaved, onDirtyChange, onPendingChange, backgroundPending, navigationBlocked, onCancelNavigation, onConfirmNavigation }: {
  editor: Editor; token: string; parent: string | null; onClose: () => void; onSaved: (item: Attachment) => void
  onDirtyChange: (value: boolean) => void; onPendingChange: (value: boolean) => void
  backgroundPending: boolean
} & NavigationProps) {
  const [name, setName] = useState(editor.item?.name ?? '')
  const [target, setTarget] = useState<string | null>(editor.item?.parent_id ?? parent)
  const [page, setPage] = useState(1)
  const [folders, setFolders] = useState<AttachmentList | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [folderError, setFolderError] = useState('')
  const [invalid, setInvalid] = useState('')
  const [discard, setDiscard] = useState(false)
  const pending = useRef(false)
  const creationId = useRef(crypto.randomUUID())
  const input = useRef<HTMLInputElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const dialog = useModalDialog(editor.mode === 'move' ? cancel : input)
  const id = useId()
  const dirty = editor.mode === 'move' ? target !== editor.item?.parent_id : name !== (editor.item?.name ?? '')
  const discarding = discard || navigationBlocked
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => { if (discarding) dialog.current?.querySelector<HTMLButtonElement>('[data-keep-editing]')?.focus() }, [discarding, dialog])
  useEffect(() => {
    if (editor.mode !== 'move') return
    const controller = new AbortController()
    void listAttachments(token, target, '', page, controller.signal, true).then((data) => { if (!controller.signal.aborted) setFolders(data) }).catch((reason) => { if (!controller.signal.aborted) setFolderError(message(reason)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [token, target, page, editor.mode, reload])
  function close() { if (pending.current) return; if (dirty) setDiscard(true); else onClose() }
  function keep() { setDiscard(false); if (navigationBlocked) onCancelNavigation() }
  function browse(folder: string | null, nextPage = 1) { setTarget(folder); setPage(nextPage); setLoading(true); setFolderError(''); setError('') }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    if (editor.mode !== 'move' && (!name.trim() || name === '.' || name === '..' || name.length > 255 || [...name].some((char) => char === '/' || char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) {
      setInvalid('请输入 1–255 字名称，不能含路径分隔符或控制字符。'); input.current?.focus(); return
    }
    pending.current = true; setBusy(true); setError(''); onPendingChange(true)
    try {
      const saved = editor.mode === 'create'
        ? await createAttachmentFolder(token, creationId.current, name, parent)
        : await updateAttachment(token, editor.item!, { name: editor.mode === 'rename' ? name : editor.item!.name, parent_id: editor.mode === 'move' ? target : editor.item!.parent_id, is_public: editor.item!.is_public })
      onSaved(saved)
    } catch (reason) { setError(message(reason)) }
    finally { pending.current = false; setBusy(false); onPendingChange(false) }
  }
  const title = editor.mode === 'create' ? '新建文件夹' : editor.mode === 'move' ? '移动附件' : '重命名'
  return <dialog ref={dialog} className="blog-link-editor" aria-labelledby={id + '-title'} aria-describedby={id + '-help'} aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (discarding) keep(); else close() }}>
    <h2 id={id + '-title'}>{discarding ? '放弃未保存的修改？' : title}</h2>
    {discarding ? <><p id={id + '-help'}>当前修改尚未保存，离开后将丢失。{navigationBlocked && '未完成的上传需重新选择文件；已保存的文件会保留。'}{(busy || backgroundPending) && '请先返回并等待操作完成，或停止上传后再离开。'}</p><footer><button data-keep-editing type="button" disabled={busy} onClick={keep}>继续编辑</button><button type="button" disabled={busy || (navigationBlocked && backgroundPending)} onClick={() => { onDirtyChange(false); if (navigationBlocked) onConfirmNavigation(); else onClose() }}>放弃修改</button></footer></> : <form noValidate onSubmit={(event) => void save(event)} onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }}>
      <p id={id + '-help'}>{editor.mode === 'create' ? '在当前目录创建一个空文件夹。' : editor.mode === 'move' ? `为「${editor.item?.name}」选择目标位置，公开链接保持原地址。` : '修改名称不会改变文件内容或公开链接。'}</p>
      {editor.mode === 'move' ? <div className="blog-attachments__picker">
        <nav aria-label="目标文件夹位置"><button type="button" disabled={busy || target === null} onClick={() => browse(null)}>全部附件</button>{folders?.breadcrumbs.map((folder, index) => <button type="button" disabled={busy || index === folders.breadcrumbs.length - 1} key={folder.id} onClick={() => browse(folder.id)}>{folder.name}</button>)}</nav>
        {loading ? <p role="status">正在加载文件夹…</p> : folderError ? <div role="alert"><p>{folderError}</p><button type="button" onClick={() => { setLoading(true); setFolderError(''); setReload((value) => value + 1) }}>重新加载文件夹</button></div> : <>
          <p>目标：{folders?.breadcrumbs.at(-1)?.name ?? '全部附件'}</p>
          <ul aria-label="可选文件夹">{folders?.items.map((folder) => <li key={folder.id}><button type="button" disabled={busy || folder.id === editor.item?.id} onClick={() => browse(folder.id)}><StudioIcon name="folder" />{folder.name}{folder.id === editor.item?.id ? '（不能移入自身）' : ' →'}</button></li>)}</ul>
          {!folders?.items.length && <p>这里没有子文件夹，可以移到当前位置。</p>}
          {(folders?.total ?? 0) > 20 && <div className="blog-attachments__picker-pages"><button type="button" disabled={busy || page === 1} onClick={() => browse(target, page - 1)}>上一页</button><span>第 {page} 页</span><button type="button" disabled={busy || page * 20 >= folders!.total} onClick={() => browse(target, page + 1)}>下一页</button></div>}
        </>}
      </div> : <><label htmlFor={id + '-name'}>名称</label><input ref={input} id={id + '-name'} maxLength={255} value={name} disabled={busy} aria-invalid={Boolean(invalid)} aria-describedby={id + '-error'} onChange={(event) => { setName(event.target.value); setInvalid(''); setError('') }} /><span id={id + '-error'}>{invalid}</span></>}
      {error && <p role="alert">{error}</p>}
      <footer><button ref={cancel} type="button" disabled={busy} onClick={close}>取消</button><button type="submit" className="blog-links__primary" disabled={busy || (editor.mode === 'move' && (loading || Boolean(folderError) || !dirty))}>{busy ? '保存中…' : editor.mode === 'move' ? '移动到此处' : '保存'}</button></footer>
    </form>}
  </dialog>
}

export function AttachmentsWorkspace({ token, onDirtyChange, onPendingChange, onFormChange, navigationBlocked, onCancelNavigation, onConfirmNavigation }: {
  token: string; onDirtyChange: (value: boolean) => void; onPendingChange: (value: boolean) => void
  onFormChange?: (value: boolean) => void
} & NavigationProps) {
  const [params, setParams] = useSearchParams()
  const parent = params.get('folder') || null
  const query = (params.get('q') ?? '').slice(0, 200)
  const parsed = Number(params.get('page') ?? '1')
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1
  const [data, setData] = useState<AttachmentList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const [composing, setComposing] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [mutation, setMutation] = useState(false)
  const [action, setAction] = useState<{ item: Attachment; type: 'delete' | 'visibility' } | null>(null)
  const [actionError, setActionError] = useState('')
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [queueVisible, setQueueVisible] = useState(10)
  const [busyFile, setBusyFile] = useState<string | null>(null)
  const [copy, setCopy] = useState<Attachment | null>(null)
  const active = useRef<AbortController | null>(null)
  const mutating = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const uploadLock = useRef(false)
  const uploadBusy = queue.some((item) => item.state === 'uploading' || item.state === 'waiting')
  const unfinished = queue.some((item) => item.state !== 'done')
  const limit = data?.max_upload_bytes ?? 200 * 1024 * 1024
  useEffect(() => { onDirtyChange(editorDirty || unfinished); return () => onDirtyChange(false) }, [editorDirty, unfinished, onDirtyChange])
  useEffect(() => { onFormChange?.(editorDirty || mutation); return () => onFormChange?.(false) }, [editorDirty, mutation, onFormChange])
  useEffect(() => { onPendingChange(mutation || uploadBusy || Boolean(busyFile)); return () => onPendingChange(false) }, [mutation, uploadBusy, busyFile, onPendingChange])
  useEffect(() => () => { active.current?.abort() }, [])
  useEffect(() => {
    if (composing) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true); setError('')
      void listAttachments(token, parent, query, page, controller.signal).then((next) => {
        if (controller.signal.aborted) return
        const last = Math.max(1, Math.ceil(next.total / 20))
        if (page > last) { setParams((current) => { const nextParams = new URLSearchParams(current); nextParams.set('page', String(last)); return nextParams }, { replace: true }); return }
        setData(next)
      }).catch((reason) => { if (!controller.signal.aborted) setError(message(reason)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [token, parent, query, page, reload, composing, setParams])
  useEffect(() => {
    if (uploadLock.current) return
    const next = queue.find((item) => item.state === 'waiting')
    if (!next) return
    uploadLock.current = true
    const controller = new AbortController()
    active.current = controller
    function update(values: Partial<QueueItem>) { setQueue((current) => current.map((item) => item.id === next!.id ? { ...item, ...values } : item)) }
    update({ state: 'uploading' })
    void uploadAttachment(token, next.id, next.file, next.parent, next.path, (percent) => update({ percent }), controller.signal).then(() => {
      update({ state: 'done', percent: 100, error: '' }); setReload((value) => value + 1)
    }).catch((reason) => update({ state: controller.signal.aborted ? 'paused' : 'error', error: controller.signal.aborted ? '已停止等待；服务端可能已保存，重试会核对结果，不会重复创建。' : message(reason) })).finally(() => { active.current = null; uploadLock.current = false })
  }, [queue, token])
  function navigateFolder(folder: string | null) { const next = new URLSearchParams(); if (folder) next.set('folder', folder); setParams(next); setLoading(true); setError('') }
  function updateParams(values: Record<string, string>) { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(values)) { if (value && !(key === 'page' && value === '1')) next.set(key, value); else next.delete(key) }; setParams(next, { replace: true }) }
  function addFiles(files: FileList | null) {
    if (!files?.length) return
    // FileList 会随选择器重置而清空，必须先固定本批文件再更新 React 状态。
    const selected = Array.from(files)
    const destination = ['全部附件', ...(data?.breadcrumbs.map((folder) => folder.name) ?? [])].join(' / ')
    const batch = selected.map((file): QueueItem => ({ id: crypto.randomUUID(), file, path: file.webkitRelativePath || file.name, parent, destination, state: file.size > limit ? 'error' : 'waiting', percent: 0, error: file.size > limit ? `单个文件不能超过 ${fileSize(limit)}。请移除此项后选择较小文件。` : '' }))
    setQueue((current) => [...current, ...batch])
    setNotice('已加入上传队列。文件会逐个保存，全部默认私有。')
  }
  function stopUploads() { setQueue((current) => current.map((item) => item.state === 'waiting' ? { ...item, state: 'paused', error: '尚未上传，可以继续上传或移除。' } : item)); active.current?.abort() }
  function closeEditor() { setEditor(null); setEditorDirty(false) }
  async function applyAction() {
    if (!action || mutating.current) return
    mutating.current = true; setMutation(true); setActionError('')
    try {
      if (action.type === 'delete') await deleteAttachment(token, action.item)
      else await updateAttachment(token, action.item, { name: action.item.name, parent_id: action.item.parent_id, is_public: !action.item.is_public })
      setNotice(action.type === 'delete' ? '已删除「' + action.item.name + '」。' : action.item.is_public ? '已撤回公开链接，之后的下载请求将不可用。' : '已公开文件，可复制下载链接。')
      setAction(null); setReload((value) => value + 1); search.current?.focus()
    } catch (reason) { setActionError(message(reason)) }
    finally { mutating.current = false; setMutation(false) }
  }
  async function download(item: Attachment) {
    if (busyFile) return
    setBusyFile(item.id); setNotice('正在准备下载「' + item.name + '」…')
    try { await downloadAttachment(token, item); setNotice('已开始下载「' + item.name + '」。') }
    catch (reason) { setNotice(message(reason)) }
    finally { setBusyFile(null) }
  }
  async function copyUrl(item: Attachment) {
    try { await navigator.clipboard.writeText(attachmentPublicUrl(item)); setNotice('已复制「' + item.name + '」的公开下载链接。') }
    catch { setCopy(item) }
  }
  const completed = queue.filter((item) => item.state === 'done').length
  return <section className="blog-links-workspace blog-attachments" aria-label="附件管理">
    <header><div><h2>文件与文件夹 <span>{data?.total ?? 0}</span></h2><p>支持任何文件类型，单个文件最多 {fileSize(limit)}，默认仅作者可见。</p></div><div className="blog-attachments__toolbar">
      <button type="button" disabled={loading || Boolean(error)} onClick={() => setEditor({ mode: 'create', item: null })}>新建文件夹</button>
      <button type="button" disabled={loading || Boolean(error)} onClick={() => folderInput.current?.click()}>上传文件夹</button>
      <button className="blog-links__primary" type="button" disabled={loading || Boolean(error)} onClick={() => fileInput.current?.click()}>上传文件</button>
      <input ref={fileInput} type="file" multiple hidden aria-label="选择上传文件" onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
      <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: '' }} aria-label="选择上传文件夹" onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
    </div></header>
    <p className="blog-attachments__help">上传文件夹会保留文件的目录层级；浏览器不会读取其中的空文件夹，可用「新建文件夹」补充。</p>
    <nav className="blog-attachments__breadcrumbs" aria-label="附件位置"><button type="button" aria-current={parent === null ? 'location' : undefined} onClick={() => navigateFolder(null)}>全部附件</button>{data?.breadcrumbs.map((folder, index) => <button key={folder.id} type="button" aria-current={index === data.breadcrumbs.length - 1 ? 'location' : undefined} onClick={() => navigateFolder(folder.id)}><span aria-hidden="true">/</span>{folder.name}</button>)}</nav>
    <div className="blog-attachments__tools"><div className="blog-links__search"><StudioIcon name="search" /><input ref={search} aria-label="搜索当前文件夹" placeholder="搜索当前文件夹中的名称" maxLength={200} value={query} onChange={(event) => updateParams({ q: event.target.value, page: '1' })} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />{query && <button type="button" aria-label="清空附件搜索" onClick={() => updateParams({ q: '', page: '1' })}><StudioIcon name="close" /></button>}</div><button type="button" disabled={loading} onClick={() => setReload((value) => value + 1)}>刷新列表</button></div>
    <p className="blog-links__notice" role="status">{notice}</p>
    {queue.length > 0 && <section className="blog-attachments__queue" aria-label="上传队列"><header><h3>上传进度 · {completed} / {queue.length}</h3><div>{uploadBusy && <button type="button" onClick={stopUploads}>停止上传</button>}{completed > 0 && <button type="button" onClick={() => setQueue((current) => current.filter((item) => item.state !== 'done'))}>清除已完成</button>}</div></header>
      <ul>{queue.slice(0, queueVisible).map((item) => <li key={item.id}><div><strong>{item.path}</strong><small>{item.destination} · {fileSize(item.file.size)}</small><span>{item.state === 'done' ? '已保存 · 私有' : item.state === 'waiting' ? '等待上传' : item.state === 'uploading' ? item.percent === 100 ? '文件已传输，正在保存…' : `正在上传 ${item.percent}%` : item.state === 'paused' ? '已停止' : '上传失败'}</span>{item.error && <p role="alert">{item.error}</p>}{item.state === 'uploading' && <progress aria-label={'上传进度：' + item.path} max={100} value={item.percent} />}</div><div>{(item.state === 'error' || item.state === 'paused') && <><button type="button" disabled={item.file.size > limit} onClick={() => setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: 'waiting', error: '', percent: 0 } : row))}>{item.state === 'paused' ? '继续上传' : '重试'}</button><button type="button" onClick={() => setQueue((current) => current.filter((row) => row.id !== item.id))}>移除</button></>}</div></li>)}</ul>
      {queue.length > queueVisible && <button type="button" onClick={() => setQueueVisible((value) => value + 20)}>显示更多上传项（还有 {queue.length - queueVisible} 项）</button>}
    </section>}
    <div className="blog-links__content" aria-busy={loading}>
      {loading ? <p role="status">正在加载附件…</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setReload((value) => value + 1)}>重新加载</button>{parent && <button type="button" onClick={() => navigateFolder(null)}>返回全部附件</button>}</div> : !data?.items.length ? <div className="blog-links__empty"><StudioIcon name="folder" /><h3>{query ? '没有匹配的附件' : '这个文件夹还是空的'}</h3><p>{query ? '换一个搜索词，或清空搜索。' : '上传文件、整个文件夹，或先新建文件夹整理内容。'}</p>{query && <button type="button" onClick={() => updateParams({ q: '', page: '1' })}>清空搜索</button>}</div> : <ul aria-label="附件列表">{data.items.map((item) => <li key={item.id}>
        <div className="blog-attachments__item"><StudioIcon name={item.kind === 'folder' ? 'folder' : 'attachment'} /><div>{item.kind === 'folder' ? <button type="button" className="blog-attachments__folder" onClick={() => navigateFolder(item.id)}>{item.name}</button> : <strong>{item.name}</strong>}<small>{item.kind === 'folder' ? '文件夹' : `${fileSize(item.size)} · ${item.is_public ? '公开链接可访问' : '私有'}`}</small></div></div>
        <div className="blog-links__actions">{item.kind === 'file' && <><button type="button" disabled={Boolean(busyFile)} onClick={() => void download(item)} aria-label={'下载：' + item.name}>{busyFile === item.id ? '准备中…' : '下载'}</button>{item.is_public && <button type="button" onClick={() => void copyUrl(item)} aria-label={'复制链接：' + item.name}>复制链接</button>}<button type="button" onClick={() => { setAction({ item, type: 'visibility' }); setActionError('') }} aria-label={(item.is_public ? '撤回公开：' : '公开：') + item.name}>{item.is_public ? '撤回公开' : '公开'}</button></>}
          <button type="button" aria-haspopup="dialog" aria-label={'重命名：' + item.name} onClick={() => setEditor({ mode: 'rename', item })}>重命名</button><button type="button" aria-haspopup="dialog" aria-label={'移动：' + item.name} onClick={() => setEditor({ mode: 'move', item })}>移动</button><button type="button" aria-label={'删除：' + item.name} onClick={() => { setAction({ item, type: 'delete' }); setActionError('') }}>删除</button>
        </div>
      </li>)}</ul>}
    </div>
    {!error && (data?.total ?? 0) > 20 && <nav className="blog-links__pagination" aria-label="附件分页"><button type="button" disabled={loading || page === 1} onClick={() => updateParams({ page: String(page - 1) })}>上一页</button><span>第 {page} / {Math.ceil(data!.total / 20)} 页</span><button type="button" disabled={loading || page * 20 >= data!.total} onClick={() => updateParams({ page: String(page + 1) })}>下一页</button></nav>}
    {editor && <AttachmentEditor editor={editor} token={token} parent={parent} onClose={closeEditor} onSaved={(item) => { closeEditor(); setNotice('已保存「' + item.name + '」。'); setReload((value) => value + 1); search.current?.focus() }} onDirtyChange={setEditorDirty} onPendingChange={setMutation} backgroundPending={uploadBusy || Boolean(busyFile)} navigationBlocked={navigationBlocked} onCancelNavigation={onCancelNavigation} onConfirmNavigation={onConfirmNavigation} />}
    {action && <BlogWorkflowDialog title={action.type === 'delete' ? '删除附件' : action.item.is_public ? '撤回公开链接' : '公开文件'} description={action.type === 'delete' ? `永久删除「${action.item.name}」后无法恢复，公开链接也会失效。文件夹仅能在清空内容后删除。` : action.item.is_public ? `撤回「${action.item.name}」后，文章或其他位置使用的下载链接也会失效。` : `公开「${action.item.name}」后，任何拿到链接的人都能下载文件。请先确认文件适合公开。`} confirmLabel={action.type === 'delete' ? '确认删除' : action.item.is_public ? '撤回公开' : '确认公开'} busy={mutation} error={actionError} onCancel={() => setAction(null)} onConfirm={() => void applyAction()} />}
    {navigationBlocked && !editor && !action && !copy && <BlogWorkflowDialog title="离开附件管理？" description={uploadBusy || mutation || busyFile ? '操作仍在进行。可取消此提醒，停止上传或等待操作完成后再离开。' : '未完成的上传只保留在当前页面，离开后需重新选择文件。已保存的文件会保留，已停止等待的上传可能仍在服务端完成。'} confirmLabel="离开附件管理" confirmDisabled={uploadBusy || mutation || Boolean(busyFile)} onCancel={onCancelNavigation} onConfirm={onConfirmNavigation} />}
    {copy && <BlogWorkflowDialog title="公开下载链接" description="浏览器未允许自动复制，可以选中下面的地址手动复制。" confirmLabel="完成" onCancel={() => setCopy(null)} onConfirm={() => setCopy(null)}><input className="blog-attachments__copy" aria-label="公开下载链接" readOnly value={attachmentPublicUrl(copy)} onFocus={(event) => event.target.select()} /></BlogWorkflowDialog>}
  </section>
}
