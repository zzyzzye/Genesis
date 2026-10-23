import { useEffect, useState } from 'react'
import { type Asset, fileBlob } from './api'

export function AssetPreview({ asset, controls = false, thumbnail = false }: { asset: Asset; controls?: boolean; thumbnail?: boolean }) {
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
  return <div className={`media-preview${thumbnail ? ' is-thumbnail' : ''}`} onPointerDown={(event) => { if ((event.target as HTMLElement).closest('video,audio,a,button')) event.stopPropagation() }}>
    {error ? <span>{thumbnail ? '预览失败' : error} <button className="nodrag nopan" aria-label={thumbnail ? `重试预览：${asset.name}` : undefined} onClick={() => { setError(''); setAttempt(attempt + 1) }}>重试</button></span> : !url ? <span>{thumbnail ? '加载中…' : '加载素材…'}</span> : asset.kind === 'image' ? <img src={url} alt={asset.name} draggable={false} onError={() => setError('此图片无法预览')} /> : asset.kind === 'video' ? <video className="nodrag nopan" src={url} controls={controls} muted={thumbnail} playsInline={thumbnail} preload="metadata" aria-label={thumbnail ? `视频参考：${asset.name}` : undefined} onError={() => setError('浏览器不支持预览，可下载原文件')} /> : controls ? <audio className="nodrag nopan" src={url} controls onError={() => setError('浏览器不支持预览，可下载原文件')} /> : <span className="media-audio-symbol" aria-label="音频素材">♫</span>}
    {controls && url && <a className="media-download nodrag nopan" href={url} download={asset.name}>下载原文件</a>}
  </div>
}
