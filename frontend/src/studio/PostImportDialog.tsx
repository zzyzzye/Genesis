import { useEffect, useRef, useState } from 'react'
import { FileArchive, FileText, LoaderCircle, Upload } from 'lucide-react'
import { ApiError, importArticles, previewArticleImport, type ArticleImportItem, type ArticleOperationResult } from '../lib/api'
import { BlogWorkflowDialog } from './BlogWorkflowDialog'
import './PostManagement.css'

export function PostImportDialog({ token, onClose, onComplete, onPendingChange }: {
  token: string
  onClose: () => void
  onComplete: (result: ArticleOperationResult) => Promise<void>
  onPendingChange: (pending: boolean) => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [items, setItems] = useState<ArticleImportItem[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const input = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)
  const lock = useRef(false)
  useEffect(() => () => request.current?.abort(), [])

  function changeFiles(next: File[]) {
    setError(''); setItems(null); setSelected([]); setAttempted(false); setOperationId(crypto.randomUUID())
    setFiles(next)
  }

  async function preview() {
    if (lock.current) return
    if (!files.length || files.length > 20 || files.some(file => !/\.(md|markdown|zip)$/i.test(file.name)) || files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) {
      setError('请选择 1–20 个 Markdown 或 ZIP 文件，上传总量不超过 20 MiB。'); input.current?.focus(); return
    }
    lock.current = true; setPreviewing(true); setError('')
    const controller = new AbortController(); request.current = controller
    try {
      const result = await previewArticleImport(token, files, controller.signal)
      if (!controller.signal.aborted) { setItems(result.items); setSelected(result.items.filter(item => !item.issue).map(item => item.path)) }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '预览失败，请检查文件后重试。')
    } finally { if (!controller.signal.aborted) setPreviewing(false); lock.current = false }
  }

  async function commit() {
    if (lock.current || !selected.length) return
    lock.current = true; setBusy(true); setAttempted(true); setError(''); onPendingChange(true)
    try {
      const result = await importArticles(token, files, operationId, selected)
      await onComplete(result)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '结果暂未确认，请重试核对。重复请求不会重复创建文章。')
    } finally { lock.current = false; setBusy(false); onPendingChange(false) }
  }

  function select(paths: string[]) { setSelected(paths); setOperationId(crypto.randomUUID()); setError('') }
  const valid = items?.filter(item => !item.issue) ?? []
  return <BlogWorkflowDialog className="post-import-dialog" title="导入文章" description="支持 Markdown、普通 ZIP 和 Genesis 导出包。只创建草稿，不覆盖同路径文章；图片、附件和评论不会导入。" confirmLabel={busy ? '正在导入…' : !items ? previewing ? '正在预览…' : '预览文件' : attempted ? '重试核对导入结果' : `导入 ${selected.length} 篇草稿`} confirmDisabled={previewing || (items !== null && !selected.length)} cancelLabel={attempted ? '关闭' : '取消'} busy={busy} error={error} onConfirm={() => { void (items ? commit() : preview()) }} onCancel={onClose}>
    <div className="post-import-files">
      <input ref={input} className="sr-only" id="post-import-files" type="file" accept=".md,.markdown,.zip" multiple aria-label="选择导入文件" disabled={busy || previewing || attempted} onChange={event => changeFiles(Array.from(event.target.files ?? []))} />
      <button type="button" disabled={busy || previewing || attempted} onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" />{files.length ? '重新选择文件' : '选择文件'}</button>
      <span>最多 20 个文件 · 共 20 MiB · 最多 200 篇文章</span>
      {files.map((file, index) => <div key={`${file.name}-${index}`} className="post-import-file">{file.name.endsWith('.zip') ? <FileArchive size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}<span>{file.name}</span><small>{(file.size / 1024).toFixed(1)} KiB</small><button type="button" aria-label={`移除文件 ${file.name}`} disabled={busy || previewing || attempted} onClick={() => changeFiles(files.filter((_, i) => i !== index))}>移除</button></div>)}
    </div>
    {previewing && <p className="post-management-loading" role="status"><LoaderCircle aria-hidden="true" />正在解析文件并检查路径冲突…</p>}
    {items && <section className="post-import-preview" aria-label="导入预览">
      <div className="post-import-summary"><strong>可导入 {valid.length} 篇 · 需处理 {items.length - valid.length} 篇</strong><button type="button" disabled={busy || attempted || !valid.length} onClick={() => select(selected.length === valid.length ? [] : valid.map(item => item.path))}>{selected.length === valid.length ? '取消全选' : '选择全部可导入项'}</button></div>
      <div className="post-import-items">{items.map(item => <label key={item.path} className={`post-import-item ${item.issue ? 'has-issue' : ''}`}><input type="checkbox" checked={selected.includes(item.path)} disabled={busy || attempted || Boolean(item.issue)} onChange={event => select(event.target.checked ? [...selected, item.path] : selected.filter(path => path !== item.path))} /><span><strong>{item.title || '未命名文章'}</strong><small>{item.path}</small><small>{item.issue || `/articles/${item.slug}`}</small>{!item.issue && (item.categories.length > 0 || item.tags.length > 0) && <small>{[...item.categories, ...item.tags].join(' · ')}</small>}</span></label>)}</div>
      {valid.length === 0 && <p>没有可导入的文章。请修改冲突文件的文章地址或修正元数据，再重新选择文件。</p>}
      {attempted && <p>保留本次文件和选择，重试只核对同一次导入。关闭不会撤销已提交的操作，可刷新文章列表确认结果。</p>}
    </section>}
  </BlogWorkflowDialog>
}
