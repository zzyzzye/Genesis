import { useEffect, useState } from 'react'
import { type Asset, fileBlob } from './api'

export function AssetPreview({ asset, controls = false }: { asset: Asset; controls?: boolean }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let objectUrl = ''
    void fileBlob(asset).then((blob) => {
      if (!active) return
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl)
    }).catch(() => { if (active) setError('素材加载失败') })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [asset, attempt])
  return <div className="media-preview" onPointerDown={(event) => { if ((event.target as HTMLElement).closest('video,audio,a,button')) event.stopPropagation() }}>
    {error ? <span>{error} <button onClick={() => { setError(''); setAttempt(attempt + 1) }}>重试</button></span> : !url ? <span>加载素材…</span> : asset.kind === 'image' ? <img src={url} alt={asset.name} draggable={false} onError={() => setError('此图片无法预览')} /> : asset.kind === 'video' ? <video src={url} controls={controls} preload="metadata" onError={() => setError('浏览器不支持预览，可下载原文件')} /> : controls ? <audio src={url} controls onError={() => setError('浏览器不支持预览，可下载原文件')} /> : <span className="media-audio-symbol" aria-label="音频素材">♫</span>}
    {controls && url && <a className="media-download" href={url} download={asset.name}>下载原文件</a>}
  </div>
}
