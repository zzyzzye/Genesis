import { authFetch, authUpload, getStoredAuthToken, handleStudioUnauthorized } from '../../lib/auth'

export type Asset = { id: string; name: string; kind: 'image' | 'video' | 'audio'; mime_type: string; size: number; in_library: boolean }
export type Project = { id: string; name: string; version: number; updated_at: string }
export type GenerationSettings = { model: string; mode: 'text' | 'reference' | 'first_last'; ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | '2:3' | '3:2'; resolution: '480P' | '720P' | '1080P' | '768P' | '2160P' | '2K'; count: 1 | 2 | 4; sound: boolean; image_size?: string; image_quality?: '' | 'low' | 'standard' | 'medium' | 'high'; image_resolution?: '' | '1K' | '2K' | '4K'; image_ratio?: '' | '1:1' | '1:2' | '2:1' | '9:16' | '16:9' | '3:4' | '4:3' | '3:2' | '2:3' | '5:4' | '4:5' | '21:9' | '9:21'; image_background?: '' | 'auto' | 'opaque' | 'transparent' }
export const defaultGenerationSettings = (): GenerationSettings => ({ model: '', mode: 'text', ratio: '16:9', resolution: '720P', count: 1, sound: true })
export type Node = { id: string; type: 'asset' | 'note' | 'text' | 'shape' | 'group' | 'video' | 'image_generation' | 'audio_generation' | 'video_asset' | 'image' | 'audio'; asset_id: string | null; member_ids?: string[]; name?: string; duration_seconds?: number; generation?: GenerationSettings; text: string; x: number; y: number; width: number; height: number }
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
  const headers = { Authorization: `Bearer ${getStoredAuthToken() ?? ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }
  const response = await authFetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  handleStudioUnauthorized(response.status, headers)
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { detail?: unknown } | null
    throw new MediaError(response.status, typeof data?.detail === 'string' ? data.detail : `请求失败（${response.status}）`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
export async function fileBlob(asset: Asset): Promise<Blob> {
  const headers = { Authorization: `Bearer ${getStoredAuthToken() ?? ''}` }
  const response = await authFetch(`${base}/assets/${asset.id}/file`, { headers })
  handleStudioUnauthorized(response.status, headers)
  if (!response.ok) throw new Error('素材读取失败，请重试')
  return response.blob()
}
export async function upload(path: string, file: File, progress: (value: number) => void): Promise<Asset> {
  const form = new FormData(); form.append('file', file)
  const request = await authUpload(`${base}${path}`, getStoredAuthToken() ?? '', form, progress)
  let data: Asset & { detail?: string }
  try { data = JSON.parse(request.responseText) as Asset & { detail?: string } } catch { throw new Error('上传失败，请重试') }
  if (request.status >= 200 && request.status < 300) return data
  throw new Error(typeof data.detail === 'string' ? data.detail : '上传失败')
}
