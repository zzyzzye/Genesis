import { ApiError } from './api'
import { authFetch, authUpload, handleStudioUnauthorized } from './auth'
import { downloadBlob } from './download'

const base = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
const admin = '/admin/blog/attachments'
export interface Attachment {
  id: string; parent_id: string | null; name: string; kind: 'file' | 'folder'
  mime_type: string; size: number; is_public: boolean; created_at: string; updated_at: string
  image_mime_type?: string | null
  preview_mime_type?: string | null
}
export interface AttachmentList { items: Attachment[]; breadcrumbs: Attachment[]; total: number; max_upload_bytes: number }

async function result<T>(response: Response, token: string): Promise<T> {
  handleStudioUnauthorized(response.status, headers(token))
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null)
    const detail = data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string' ? data.detail : '请检查输入并重试'
    throw new ApiError(response.status, detail)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
function headers(token: string) { return { Authorization: `Bearer ${token}` } }
export async function listAttachments(token: string, folder: string | null, query: string, page: number, signal?: AbortSignal, foldersOnly = false): Promise<AttachmentList> {
  const params = new URLSearchParams({ q: query, limit: '20', offset: String((page - 1) * 20) })
  if (folder) params.set('folder_id', folder)
  if (foldersOnly) params.set('kind', 'folder')
  return result(await authFetch(`${base}${admin}?${params}`, { headers: headers(token), signal }), token)
}
export async function createAttachmentFolder(token: string, id: string, name: string, parent: string | null): Promise<Attachment> {
  return result(await authFetch(`${base}${admin}/folders`, { method: 'POST', headers: { ...headers(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, parent_id: parent }) }), token)
}
export async function getAttachment(token: string, id: string): Promise<Attachment> {
  return result(await authFetch(`${base}${admin}/${id}`, { headers: headers(token) }), token)
}
export async function updateAttachment(token: string, item: Attachment, data: Pick<Attachment, 'name' | 'parent_id' | 'is_public'>): Promise<Attachment> {
  return result(await authFetch(`${base}${admin}/${item.id}`, { method: 'PUT', headers: { ...headers(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, expected_updated_at: item.updated_at }) }), token)
}
export async function deleteAttachment(token: string, item: Attachment): Promise<void> {
  return result(await authFetch(`${base}${admin}/${item.id}?${new URLSearchParams({ expected_updated_at: item.updated_at })}`, { method: 'DELETE', headers: headers(token) }), token)
}
export function attachmentPublicUrl(item: Attachment) { return new URL(`${base}/blog/attachments/${item.id}/file`, window.location.origin).href }
export function attachmentMarkdown(item: Attachment): string {
  const label = item.name.replace(/[\\`*_[\]<>!{}|~&]/g, '\\$&')
  const url = item.image_mime_type ? new URL(`${base}/blog/attachments/${item.id}/image`, window.location.origin).href : attachmentPublicUrl(item)
  return `${item.image_mime_type ? '!' : ''}[${label}](${url})`
}
export async function downloadAttachment(token: string, item: Attachment): Promise<void> {
  const response = await authFetch(`${base}${admin}/${item.id}/file`, { headers: headers(token) })
  if (!response.ok) { await result(response, token); return }
  downloadBlob(await response.blob(), item.name)
}

export async function fetchAttachmentPreview(token: string, item: Attachment, signal: AbortSignal): Promise<{ blob: Blob; truncated: boolean }> {
  const response = await authFetch(`${base}${admin}/${item.id}/preview`, { headers: headers(token), signal })
  if (!response.ok) { await result(response, token); throw new Error('预览不可用') }
  return { blob: await response.blob(), truncated: response.headers.get('X-Preview-Truncated') === 'true' }
}

export async function uploadAttachment(token: string, id: string, file: File, parent: string | null, path: string, onProgress: (percent: number) => void, signal: AbortSignal): Promise<Attachment> {
  const form = new FormData()
  form.append('id', id); form.append('file', file); form.append('relative_path', path)
  if (parent) form.append('parent_id', parent)
  const xhr = await authUpload(`${base}${admin}/files`, token, form, onProgress, signal)
  let data: unknown
  try { data = JSON.parse(xhr.responseText) } catch { throw new Error('上传回执无法解析，请重试核对结果。') }
  if (xhr.status >= 200 && xhr.status < 300) return data as Attachment
  throw new ApiError(xhr.status, data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string' ? data.detail : '上传未完成，请重试')
}
