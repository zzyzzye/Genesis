import { lazy, Suspense, useEffect, useState } from 'react'
import { Download, ImageOff, ImagePlus, RotateCcw } from 'lucide-react'
import { type Asset, fileBlob, playbackUrl } from './api'
import { getStoredAuthToken } from '../../lib/auth'

const MediaPlayer = lazy(() => import('./MediaPlayer'))

type ImageState = { url: string; error: string }
type ImageEntry = ImageState & { controller: AbortController; listeners: Set<(state: ImageState) => void> }
const images = new Map<string, ImageEntry>()

function subscribeImage(id: string, session: string | null, listener: (state: ImageState) => void) {
  // 同一会话中的成品与参考缩略图共用一次读取；不跨登录会话复用私有图片。
  const key = JSON.stringify([session, id])
  let entry = images.get(key)
  if (!entry || entry.error) {
    entry = { url: '', error: '', controller: new AbortController(), listeners: new Set() }
    images.set(key, entry)
    const loading = entry
    void fileBlob({ id }, loading.controller.signal).then(blob => {
      if (loading.controller.signal.aborted) return
      loading.url = URL.createObjectURL(blob)
      loading.listeners.forEach(notify => notify(loading))
    }).catch(() => {
      if (loading.controller.signal.aborted) return
      loading.error = '素材加载失败'
      loading.listeners.forEach(notify => notify(loading))
    })
  }
  const shared = entry
  shared.listeners.add(listener)
  listener(shared)
  return () => {
    shared.listeners.delete(listener)
    if (shared.listeners.size) return
    shared.controller.abort()
    if (shared.url) URL.revokeObjectURL(shared.url)
    if (images.get(key) === shared) images.delete(key)
  }
}

export function AssetPreview(props: { asset: Asset; controls?: boolean; thumbnail?: boolean; passive?: boolean; onImageDimensions?: (width: number, height: number) => void }) {
  return <AssetPreviewContent key={`${props.asset.id}:${props.asset.kind}`} {...props} />
}

function AssetPreviewContent({ asset, controls = false, thumbnail = false, passive = false, onImageDimensions }: { asset: Asset; controls?: boolean; thumbnail?: boolean; passive?: boolean; onImageDimensions?: (width: number, height: number) => void }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const streaming = asset.kind === 'video' || asset.kind === 'audio'
  const assetId = asset.id
  const session = getStoredAuthToken()
  const retry = () => { setUrl(''); setError(''); setAttempt((value) => value + 1) }
  useEffect(() => {
    if (!streaming) return subscribeImage(assetId, session, state => { setUrl(state.url); setError(state.error) })
    let active = true
    const controller = new AbortController()
    const load = playbackUrl(assetId, controller.signal)
    void load.then((result) => {
      if (!active) return
      setUrl(result)
    }).catch(() => { if (active) setError('素材加载失败') })
    return () => { active = false; controller.abort() }
    // 改名与目录刷新不应重新下载同一素材。
  }, [assetId, streaming, attempt, session])
  return <div className={`media-preview${thumbnail ? ' is-thumbnail' : ''}`} onPointerDown={(event) => { if ((event.target as HTMLElement).closest('video,audio,a,button,.media-player-shell')) event.stopPropagation() }}>
    {thumbnail && (error || !url) ? <div className="media-thumbnail-placeholder">
      {error ? passive ? <ImageOff size={20} role="img" aria-label="预览暂不可用" /> : <button type="button" className="media-thumbnail-retry nodrag nopan" aria-label={`重试预览：${asset.name}`} title={`${error}，点击重试`} onClick={retry}><RotateCcw size={18} strokeWidth={1.6} aria-hidden="true" /></button> : <ImagePlus size={20} strokeWidth={1.6} role="img" aria-label={`正在加载预览：${asset.name}`} />}
    </div> : error ? <span>{error} {!passive && <button className="nodrag nopan" onClick={retry}>重试</button>}</span> : !url ? <span>加载素材…</span> : asset.kind === 'image' ? <img src={url} alt={asset.name} draggable={false} onLoad={(event) => onImageDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} onError={() => setError('此图片无法预览')} /> : controls && !thumbnail && (asset.kind === 'video' || asset.kind === 'audio') ? <Suspense fallback={<span>加载播放器…</span>}>
      <MediaPlayer key={url} src={url} kind={asset.kind} name={asset.name} onError={() => setError('素材播放失败，请重试或下载原文件')} />
    </Suspense> : asset.kind === 'video' ? <video className="nodrag nopan" src={url} crossOrigin="use-credentials" muted={thumbnail} playsInline preload="metadata" aria-label={thumbnail ? `视频参考：${asset.name}` : undefined} onError={() => setError('视频加载失败，请重试或下载原文件')} /> : <span className="media-audio-symbol" aria-label="音频素材">♫</span>}
    {controls && url && <a className="media-download nodrag nopan" href={streaming ? `${url}?download=true` : url} download={asset.download_name ?? asset.name} aria-label="下载原文件" title="下载原文件"><Download size={15} aria-hidden="true" /></a>}
  </div>
}
