import { fileBlob } from './api'

type ImageState = { url: string; error: string }
type ImageEntry = ImageState & { controller: AbortController; listeners: Set<(state: ImageState) => void> }
const images = new Map<string, ImageEntry>()

export function subscribeImage(id: string, session: string | null, listener: (state: ImageState) => void) {
  // 同一会话中的成品、参考栏与候选菜单共用一次读取，不跨会话复用私有图片。
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
