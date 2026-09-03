export interface BlogAuthor {
  id: string
  handle: string
  display_name: string
  avatar_url: string | null
}

export interface BlogTag {
  id: string
  name: string
  slug: string
}

export interface BlogPostPreview {
  id: string
  slug: string
  title: string
  excerpt: string
  cover_image_url: string | null
  is_featured: boolean
  read_time_minutes: number
  published_at: string
  author: BlogAuthor
  tags: BlogTag[]
}

export interface BlogPostDetail extends BlogPostPreview {
  content_markdown: string
}

export type BlogPostStatus = 'draft' | 'published'

export interface BlogTagWrite {
  name: string
  slug: string
}

export interface BlogPostWrite {
  slug: string
  title: string
  excerpt: string
  content_markdown: string
  cover_image_url: string | null
  status: BlogPostStatus
  is_featured: boolean
  read_time_minutes: number
  tags: BlogTagWrite[]
}

export interface BlogPostAdmin extends BlogPostWrite {
  id: string
  published_at: string | null
  created_at: string
  updated_at: string
  author: BlogAuthor
  tags: BlogTag[]
}

export interface CurrentUser {
  id: string
  handle: string
  display_name: string
  bio: string
  avatar_url: string | null
  role: string
}

export interface RegistrationData {
  handle: string
  display_name: string
  password: string
}

export interface ProfileUpdateData {
  display_name: string
  bio: string
  avatar_url: string | null
}

interface BlogPostListResponse {
  items: BlogPostPreview[]
  total: number
}

interface AccessToken {
  access_token: string
  token_type: 'bearer'
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init)
  if (!response.ok) {
    throw new Error(`请求失败：HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export function getBlogPosts(signal?: AbortSignal): Promise<BlogPostListResponse> {
  return request<BlogPostListResponse>('/blog/posts', { signal })
}

export function getBlogPost(slug: string, signal?: AbortSignal): Promise<BlogPostDetail> {
  return request<BlogPostDetail>(`/blog/posts/${encodeURIComponent(slug)}`, { signal })
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

export function login(handle: string, password: string): Promise<AccessToken> {
  const body = new URLSearchParams({ username: handle, password })
  return request<AccessToken>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
}

export function registerAccount(data: RegistrationData): Promise<CurrentUser> {
  return request<CurrentUser>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function getCurrentUser(token: string): Promise<CurrentUser> {
  return request<CurrentUser>('/auth/me', { headers: authHeaders(token) })
}

export function updateCurrentUser(token: string, data: ProfileUpdateData): Promise<CurrentUser> {
  return request<CurrentUser>('/auth/me', {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function getAdminBlogPosts(token: string): Promise<BlogPostAdmin[]> {
  return request<BlogPostAdmin[]>('/admin/blog/posts', { headers: authHeaders(token) })
}

export function createAdminBlogPost(token: string, data: BlogPostWrite): Promise<BlogPostAdmin> {
  return request<BlogPostAdmin>('/admin/blog/posts', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function updateAdminBlogPost(
  token: string,
  id: string,
  data: BlogPostWrite,
): Promise<BlogPostAdmin> {
  return request<BlogPostAdmin>(`/admin/blog/posts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteAdminBlogPost(token: string, id: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/admin/blog/posts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
  if (!response.ok) {
    throw new Error(`请求失败：HTTP ${response.status}`)
  }
}
