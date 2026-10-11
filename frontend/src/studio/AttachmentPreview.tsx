import { useEffect, useRef, useState } from 'react'
import { fetchAttachmentPreview, type Attachment } from '../lib/attachments'
import { StudioIcon } from './StudioIcon'
import { useModalDialog } from './useModalDialog'
import './AttachmentPreview.css'

function previewType(item: Attachment) { return item.preview_mime_type ?? item.image_mime_type ?? null }

export function AttachmentThumbnail({ item, token }: { item: Attachment; token: string }) {
  const container = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [loaded, setLoaded] = useState<{ item: Attachment; url: string; failed: boolean } | null>(null)
  const url = loaded?.item === item ? loaded.url : ''
  const image = Boolean(item.image_mime_type) && item.size <= 8 * 1024 * 1024
  useEffect(() => {
    if (!image || !container.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '80px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [image])
  useEffect(() => {
    if (!image || !visible) return
    const controller = new AbortController()
    let objectUrl = ''
    void fetchAttachmentPreview(token, item, controller.signal).then(({ blob }) => {
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setLoaded({ item, url: objectUrl, failed: false })
    }).catch(() => { if (!controller.signal.aborted) setLoaded({ item, url: '', failed: true }) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [image, visible, token, item])
  return <span ref={container} className="attachment-thumbnail" aria-hidden="true">
    {url && !loaded?.failed ? <img src={url} alt="" onError={() => setLoaded({ item, url: '', failed: true })} /> : <StudioIcon name={item.kind === 'folder' ? 'folder' : item.image_mime_type ? 'palette' : previewType(item)?.startsWith('video/') ? 'media' : 'attachment'} />}
  </span>
}

export function AttachmentPreviewContent({ item, token }: { item: Attachment; token: string }) {
  return <AttachmentPreviewLoader key={item.id + item.updated_at} item={item} token={token} />
}

function AttachmentPreviewLoader({ item, token }: { item: Attachment; token: string }) {
  const [state, setState] = useState<{ url: string; text: string; mime: string; truncated: boolean } | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const mime = previewType(item)
  const supported = mime !== null && (mime === 'text/plain' || item.size <= 64 * 1024 * 1024)
  useEffect(() => {
    if (!supported) return
    const controller = new AbortController()
    let objectUrl = ''
    void fetchAttachmentPreview(token, item, controller.signal).then(async ({ blob, truncated }) => {
      const actualMime = blob.type.split(';')[0] ?? ''
      const text = actualMime === 'text/plain' ? await blob.text() : ''
      if (controller.signal.aborted) return
      if (actualMime !== 'text/plain' && actualMime !== 'application/pdf' && !/^(image|audio|video)\//.test(actualMime)) throw new Error('此格式暂不支持在线预览，请下载后打开。')
      if (actualMime !== 'text/plain') objectUrl = URL.createObjectURL(blob)
      setState({ url: objectUrl, text, mime: actualMime, truncated })
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '预览加载失败，请重试。') })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [item, token, reload, supported])
  function mediaFailed() { setError('浏览器无法解码此文件，请下载后使用对应软件打开。') }
  return <section className="attachment-preview-content" aria-label="附件预览内容">
    <p className="attachment-preview-meta">{(item.size / 1024).toFixed(1)} KiB · {mime ?? item.mime_type} · {item.is_public ? '已公开' : '私有，仅作者可见'}</p>
    {!supported ? <div className="attachment-preview-placeholder"><StudioIcon name="attachment" /><strong>{mime ? '文件较大，请下载后打开' : '此格式暂不支持在线预览'}</strong><p>{mime ? '在线媒体预览支持 64 MiB 以内的文件。' : '可预览图片、PDF、常见音视频和 UTF-8 文本；其他文件仍可保存、插入和下载。'}</p></div> : error ? <div className="attachment-preview-placeholder" role="alert"><p>{error}</p><button type="button" onClick={() => { setState(null); setError(''); setReload(value => value + 1) }}>重新加载预览</button></div> : !state ? <div className="attachment-preview-placeholder" role="status">正在加载预览…</div> : <div className="attachment-preview-stage">
      {state.mime.startsWith('image/') && <img src={state.url} alt={item.name} onError={mediaFailed} />}
      {state.mime.startsWith('audio/') && <audio src={state.url} controls preload="metadata" onError={mediaFailed} />}
      {state.mime.startsWith('video/') && <video src={state.url} controls preload="metadata" onError={mediaFailed} />}
      {state.mime === 'application/pdf' && <iframe src={state.url} title={'PDF 预览：' + item.name} referrerPolicy="no-referrer" />}
      {state.mime === 'text/plain' && <><pre tabIndex={0}>{state.text || '（文件为空）'}</pre>{state.truncated && <p role="status">仅显示前 256 KiB，完整内容请下载查看。</p>}</>}
    </div>}
  </section>
}

export function AttachmentPreviewDialog({ item, token, onClose, onDownload, downloading }: {
  item: Attachment; token: string; onClose: () => void; onDownload: () => Promise<string | undefined> | void; downloading: boolean
}) {
  const close = useRef<HTMLButtonElement>(null)
  const dialog = useModalDialog(close)
  const [downloadError, setDownloadError] = useState('')
  return <dialog ref={dialog} className="blog-link-editor attachment-preview-dialog" aria-labelledby="attachment-preview-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <header><div><span>附件预览</span><h2 id="attachment-preview-title">{item.name}</h2></div><button ref={close} type="button" aria-label="关闭附件预览" onClick={onClose}><StudioIcon name="close" /></button></header>
    <AttachmentPreviewContent item={item} token={token} />
    {downloadError && <p role="alert">{downloadError}</p>}
    <footer><button type="button" disabled={downloading} onClick={() => { setDownloadError(''); void Promise.resolve(onDownload()).then(reason => setDownloadError(reason ?? '')) }}>{downloading ? '正在准备下载…' : '下载文件'}</button><button type="button" onClick={onClose}>关闭预览</button></footer>
  </dialog>
}
