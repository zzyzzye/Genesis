import { authHeaders, request, type BlogPostWrite } from './api'

export interface RevisionSummary { id: string; title: string; version: string }
export type RevisionPayload = Pick<BlogPostWrite, 'title' | 'excerpt' | 'content_markdown' | 'cover_image_url' | 'category_ids' | 'tags' | 'is_featured' | 'read_time_minutes' | 'slug'>
export interface RevisionDetail extends RevisionSummary { payload: RevisionPayload }
export function getRevisions(token: string, postId: string, offset: number, signal: AbortSignal) {
  return request<{ items: RevisionSummary[]; total: number }>(`/admin/blog/posts/${postId}/revisions?offset=${offset}`, { headers: authHeaders(token), signal })
}
export function getRevision(token: string, postId: string, revisionId: string, signal: AbortSignal) {
  return request<RevisionDetail>(`/admin/blog/posts/${postId}/revisions/${revisionId}`, { headers: authHeaders(token), signal })
}
