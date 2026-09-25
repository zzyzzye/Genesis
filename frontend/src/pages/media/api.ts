import { getStoredAuthToken } from '../../lib/auth'

export type Asset = { id: string; name: string; kind: 'image' | 'video' | 'audio'; mime_type: string; size: number; in_library: boolean }
export type Project = { id: string; name: string; version: number; updated_at: string }
export type Node = { id: string; type: 'asset' | 'note' | 'text' | 'shape' | 'group' | 'video'; asset_id: string | null; member_ids?: string[]; name?: string; duration_seconds?: number; text: string; x: number; y: number; width: number; height: number }
export type Edge = { id: string; source: string; target: string }
export type VideoFrame = { width: number; height: number }
export const defaultVideoFrame = (): VideoFrame => ({ width: 1920, height: 1080 })
export type Document = { nodes: Node[]; edges: Edge[]; background: 'dots' | 'lines' | 'none'; frame: VideoFrame; viewport: { x: number; y: number; zoom: number } }
export type Snapshot = { version: number; document: Document }
export const emptyDocument = (): Document => ({ nodes: [], edges: [], background: 'dots', frame: defaultVideoFrame(), viewport: { x: 0, y: 0, zoom: 1 } })
export const base = `${import.meta.env.VITE_API_BASE_URL ?? '/api/v1'}/media`
export class MediaError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${getStoredAuthToken() ?? ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { detail?: unknown } | null
    throw new MediaError(response.status, typeof data?.detail === 'string' ? data.detail : `请求失败（${response.status}）`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
export async function fileBlob(asset: Asset): Promise<Blob> {
  const response = await fetch(`${base}/assets/${asset.id}/file`, { headers: { Authorization: `Bearer ${getStoredAuthToken() ?? ''}` } })
  if (!response.ok) throw new Error('素材读取失败，请重试')
  return response.blob()
}
export function upload(path: string, file: File, progress: (value: number) => void): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `${base}${path}`)
    request.setRequestHeader('Authorization', `Bearer ${getStoredAuthToken() ?? ''}`)
    request.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)) }
    request.onerror = () => reject(new Error('网络中断，请重试上传'))
    request.onload = () => {
      let data: Asset & { detail?: string }
      try { data = JSON.parse(request.responseText) as Asset & { detail?: string } } catch { reject(new Error('上传失败，请重试')); return }
      if (request.status >= 200 && request.status < 300) resolve(data)
      else reject(new Error(typeof data.detail === 'string' ? data.detail : '上传失败'))
    }
    const form = new FormData(); form.append('file', file); request.send(form)
  })
}
