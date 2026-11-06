import { fileBlob } from './api'
import { accountAuthTokenKey, authTokenChangedEvent, studioAuthTokenKey } from '../../lib/auth'

type ImageState = { url: string; error: string }
type ImageEntry = ImageState & { controller: AbortController; listeners: Set<(state: ImageState) => void>; bytes: number; timer?: ReturnType<typeof setTimeout> }
const images = new Map<string, ImageEntry>()
const idleLifetime = 5 * 60 * 1000
const maxBytes = 64 * 1024 * 1024

function dispose(key: string, entry: ImageEntry) {
  clearTimeout(entry.timer)
  entry.controller.abort()
  if (entry.url) URL.revokeObjectURL(entry.url)
  entry.url = ''
  if (images.get(key) === entry) images.delete(key)
}

export function clearImageCache() {
  for (const [key, entry] of images) {
    dispose(key, entry)
    entry.listeners.forEach(notify => notify({ url: '', error: '' }))
  }
}

window.addEventListener(authTokenChangedEvent, clearImageCache)
window.addEventListener('storage', event => {
  if (event.key === null || event.key === accountAuthTokenKey || event.key === studioAuthTokenKey) clearImageCache()
})

export function invalidateImage(id: string, session: string | null, thumbnail = false) {
  const key = JSON.stringify([session, id, thumbnail])
  const entry = images.get(key)
  if (!entry) return
  images.delete(key)
  // 其他预览可以继续显示旧地址，最后一个订阅关闭后再释放。
  if (!entry.listeners.size) dispose(key, entry)
}

function trimCache() {
  let bytes = [...images.values()].reduce((sum, entry) => sum + entry.bytes, 0)
  for (const [key, entry] of images) {
    if (bytes <= maxBytes && images.size <= 128) break
    // 正在显示的素材由组件持有；只淘汰闲置项，避免图片闪烁。
    if (entry.listeners.size) continue
    bytes -= entry.bytes
    dispose(key, entry)
  }
}

export function subscribeImage(id: string, session: string | null, listener: (state: ImageState) => void, thumbnail = false) {
  // 同一会话中的成品、参考栏与候选菜单共用一次读取，不跨会话复用私有图片。
  const key = JSON.stringify([session, id, thumbnail])
  let entry = images.get(key)
  if (!entry || entry.error) {
    if (entry) dispose(key, entry)
    entry = { url: '', error: '', controller: new AbortController(), listeners: new Set(), bytes: 0 }
    images.set(key, entry)
    const loading = entry
    void fileBlob({ id }, loading.controller.signal, thumbnail).then(blob => {
      if (loading.controller.signal.aborted) return
      loading.url = URL.createObjectURL(blob)
      loading.bytes = blob.size
      loading.listeners.forEach(notify => notify(loading))
      trimCache()
    }).catch(() => {
      if (loading.controller.signal.aborted) return
      loading.error = '素材加载失败'
      loading.listeners.forEach(notify => notify(loading))
    })
  }
  const shared = entry
  clearTimeout(shared.timer)
  images.delete(key)
  images.set(key, shared)
  shared.listeners.add(listener)
  listener(shared)
  return () => {
    shared.listeners.delete(listener)
    if (shared.listeners.size) return
    if (images.get(key) !== shared) { dispose(key, shared); return }
    // 短暂卸载不取消在途请求，重新展开、StrictMode 挂载也能复用。
    shared.timer = setTimeout(() => dispose(key, shared), idleLifetime)
    trimCache()
  }
}
