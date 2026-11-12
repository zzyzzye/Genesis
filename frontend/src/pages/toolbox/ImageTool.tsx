import { useEffect, useRef, useState } from 'react'
import { Download, ImagePlus, RefreshCw, X } from 'lucide-react'
import { ToolboxLayout } from './ToolboxLayout'
import { downloadBlob } from '../../lib/download'
import { encodeImage, formatBytes, imageFormats, maxPixels, outputDimensions, outputFilename, validateImage, type ImageFormat } from './imageProcessing'
import './ImageTool.css'

type Source = { file: File; bitmap: ImageBitmap; url: string }
type Result = { blob: Blob; width: number; height: number; url: string; name: string }

export function ImageTool() {
  const [source, setSource] = useState<Source | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [format, setFormat] = useState<ImageFormat>('image/webp')
  const [quality, setQuality] = useState(82)
  const [maxEdge, setMaxEdge] = useState('')
  const [background, setBackground] = useState<'#ffffff' | '#000000'>('#ffffff')
  const [busy, setBusy] = useState<'reading' | 'encoding' | null>(null)
  const [error, setError] = useState('')
  const [sizeError, setSizeError] = useState('')
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const edgeInput = useRef<HTMLInputElement>(null)
  const resources = useRef<{ source: Source | null; result: Result | null }>({ source: null, result: null })
  const job = useRef(0)
  const locked = useRef(false)

  function clearResult() {
    if (resources.current.result) URL.revokeObjectURL(resources.current.result.url)
    resources.current.result = null; setResult(null)
  }
  useEffect(() => {
    const current = resources.current
    return () => {
      job.current += 1
      current.source?.bitmap.close()
      if (current.source) URL.revokeObjectURL(current.source.url)
      if (current.result) URL.revokeObjectURL(current.result.url)
    }
  }, [])

  async function select(files: FileList | File[]) {
    if (locked.current || !files.length) return
    if (files.length !== 1) { setError('每次处理一张图片，请只选择一个文件。'); return }
    const file = files[0]!
    locked.current = true; setBusy('reading'); setError('')
    const id = ++job.current
    let bitmap: ImageBitmap | null = null
    try {
      await validateImage(file)
      try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
      catch { throw new Error('无法读取图片，文件可能损坏或当前浏览器不支持。请换一张图片。') }
      if (id !== job.current) { bitmap.close(); return }
      if (bitmap.width * bitmap.height > maxPixels || Math.max(bitmap.width, bitmap.height) > 8192) throw new Error('图片尺寸过大，请使用不超过 2400 万像素、单边不超过 8192 像素的图片。')
      const next = { file, bitmap, url: URL.createObjectURL(file) }
      resources.current.source?.bitmap.close()
      if (resources.current.source) URL.revokeObjectURL(resources.current.source.url)
      clearResult(); resources.current.source = next; setSource(next)
    } catch (reason) {
      bitmap?.close()
      if (id === job.current) setError((reason as Error).message)
    } finally {
      if (id === job.current) { locked.current = false; setBusy(null) }
    }
  }

  async function process() {
    if (!source || locked.current) return
    const edge = maxEdge.trim() ? Number(maxEdge) : null
    try { outputDimensions(source.bitmap.width, source.bitmap.height, edge) }
    catch (reason) { setSizeError((reason as Error).message); edgeInput.current?.focus(); return }
    setSizeError('')
    locked.current = true; setBusy('encoding'); setError(''); clearResult()
    const id = ++job.current
    try {
      // 先展示忙碌状态，再开始像素处理。
      await new Promise<void>(resolve => window.setTimeout(resolve, 0))
      if (id !== job.current) return
      const encoded = await encodeImage(source.bitmap, { format, quality: quality / 100, maxEdge: edge, background })
      if (id !== job.current) return
      const next = { ...encoded, url: URL.createObjectURL(encoded.blob), name: outputFilename(source.file.name, format) }
      resources.current.result = next; setResult(next)
    } catch (reason) { if (id === job.current) setError((reason as Error).message || '处理失败，请降低尺寸后重试。') }
    finally { if (id === job.current) { locked.current = false; setBusy(null) } }
  }

  function reset() {
    job.current += 1; locked.current = false; setBusy(null)
    resources.current.source?.bitmap.close()
    if (resources.current.source) URL.revokeObjectURL(resources.current.source.url)
    resources.current.source = null; setSource(null); clearResult(); setError(''); setSizeError('')
  }
  const difference = source && result ? (1 - result.blob.size / source.file.size) * 100 : 0

  return <ToolboxLayout pageTitle="图片转换与压缩"><div className="image-tool">
    <header className="image-tool-heading"><h1>图片转换与压缩</h1><p>转换格式，减小体积。图片仅在当前浏览器处理，无需上传或登录。</p></header>
    <input ref={input} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" tabIndex={-1} aria-label="选择图片文件" disabled={!!busy} onChange={event => { if (event.target.files) void select(event.target.files); event.target.value = '' }} />
    <div className={`image-tool-picker${dragging ? ' is-dragging' : ''}${source ? ' has-image' : ''}`} onDragOver={event => { event.preventDefault(); if (!locked.current) setDragging(true) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }} onDrop={event => { event.preventDefault(); setDragging(false); void select(event.dataTransfer.files) }}>
      <ImagePlus aria-hidden="true" /><div><strong>{source ? source.file.name : '选择图片，或将图片拖到这里'}</strong><p>{source ? `${source.bitmap.width} × ${source.bitmap.height} · ${formatBytes(source.file.size)}` : 'PNG、JPEG、WebP · 单张最多 20 MB / 2400 万像素'}</p></div><button type="button" disabled={!!busy} onClick={() => input.current?.click()}>{source ? '更换图片' : '选择图片'}</button>{source && <button type="button" aria-label="移除图片" disabled={!!busy} onClick={reset}><X /></button>}
    </div>
    <div className="image-tool-workspace">
      <form className="image-tool-settings" noValidate onSubmit={event => { event.preventDefault(); void process() }}>
        <fieldset disabled={!!busy}><legend>输出格式</legend><div className="image-tool-options">{imageFormats.map(item => <button key={item.mime} type="button" aria-pressed={format === item.mime} onClick={() => { setFormat(item.mime); clearResult() }}>{item.label}</button>)}</div></fieldset>
        <label className="image-tool-quality" htmlFor="image-quality"><span>画质 <output>{format === 'image/png' ? '无损编码' : `${quality}%`}</output></span><input id="image-quality" type="range" min="10" max="100" value={quality} disabled={!!busy || format === 'image/png'} onChange={event => { setQuality(Number(event.target.value)); clearResult() }} /></label>
        <p className="image-tool-hint">{format === 'image/png' ? 'PNG 不使用画质参数。可缩小尺寸减小体积，或改用 WebP。' : '画质越低，文件通常越小；细节也可能减少。'}</p>
        <label className="image-tool-size" htmlFor="image-max-edge">最长边（像素）<input ref={edgeInput} id="image-max-edge" type="number" min="1" max="8192" step="1" placeholder="留空保留原尺寸" value={maxEdge} disabled={!!busy} aria-invalid={!!sizeError} aria-describedby={sizeError ? 'image-size-help image-size-error' : 'image-size-help'} onChange={event => { setMaxEdge(event.target.value); setSizeError(''); setError(''); clearResult() }} /></label><p id="image-size-help" className="image-tool-hint">等比缩小，不放大原图。范围 1–8192。</p>{sizeError && <p id="image-size-error" className="image-tool-field-error" role="alert">{sizeError}</p>}
        {format === 'image/jpeg' && <fieldset disabled={!!busy}><legend>透明区域底色</legend><div className="image-tool-options">{([{ value: '#ffffff', label: '白色' }, { value: '#000000', label: '黑色' }] as const).map(item => <button key={item.value} type="button" aria-pressed={background === item.value} onClick={() => { setBackground(item.value); clearResult() }}>{item.label}</button>)}</div><p className="image-tool-hint">JPEG 不支持透明；PNG 和 WebP 保留透明区域。</p></fieldset>}
        <button className="image-tool-primary" type="submit" disabled={!source || !!busy} aria-busy={!!busy}><RefreshCw size={17} />{busy === 'reading' ? '正在读取…' : busy === 'encoding' ? '正在处理…' : '转换并压缩'}</button>
        <p className="image-tool-hint">输出为静态图片；动图仅处理首帧。不会保留原图的 EXIF 等元数据。结果不保证比原文件更小。</p>
        <p className="image-tool-hint">刷新或离开页面会清空图片，请及时下载结果。</p>
      </form>
      <section className="image-tool-results" aria-label="图片处理结果">
        <div className="image-tool-feedback" aria-live="polite">{error && <p role="alert">{error}</p>}{busy && <p role="status">{busy === 'reading' ? '正在读取图片…' : '正在转换并压缩图片…'}</p>}{result && <p role="status">处理完成 · {difference >= 0 ? `减少 ${difference.toFixed(1)}%` : `增大 ${Math.abs(difference).toFixed(1)}%，可降低画质或尺寸再试`}</p>}</div>
        <div className="image-tool-previews"><figure><figcaption>原图 {source && <span>{formatBytes(source.file.size)}</span>}</figcaption><div className="image-tool-preview">{source ? <img src={source.url} alt="原图预览" /> : <p>选择图片后查看原图</p>}</div></figure><figure><figcaption>处理后 {result && <span>{formatBytes(result.blob.size)}</span>}</figcaption><div className="image-tool-preview">{result ? <img src={result.url} alt="处理后的图片预览" /> : <p>{busy === 'encoding' ? '正在生成结果…' : '调整参数后，点击转换并压缩'}</p>}</div></figure></div>
        {result && <div className="image-tool-download"><div><strong>{result.name}</strong><p>{result.width} × {result.height} · {formatBytes(result.blob.size)}</p></div><button className="image-tool-primary" type="button" onClick={() => downloadBlob(result.blob, result.name)}><Download size={17} />下载图片</button></div>}
      </section>
    </div>
  </div></ToolboxLayout>
}
