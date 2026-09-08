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

export interface BlogCategory {
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
  category: BlogCategory | null
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

export interface BlogCategoryWrite {
  name: string
  slug: string
}

export interface BlogPostWrite {
  slug: string
  title: string
  excerpt: string
  content_markdown: string
  cover_image_url: string | null
  category_id: string | null
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
  category: BlogCategory | null
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

export function getAdminBlogTags(token: string): Promise<BlogTag[]> {
  return request<BlogTag[]>('/admin/blog/tags', { headers: authHeaders(token) })
}

export function createAdminBlogTag(token: string, data: BlogTagWrite): Promise<BlogTag> {
  return request<BlogTag>('/admin/blog/tags', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function getAdminBlogCategories(token: string): Promise<BlogCategory[]> {
  return request<BlogCategory[]>('/admin/blog/categories', { headers: authHeaders(token) })
}

export function createAdminBlogCategory(token: string, data: BlogCategoryWrite): Promise<BlogCategory> {
  return request<BlogCategory>('/admin/blog/categories', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
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
export interface SystemHealth {
  status: 'ok'
  system: 'tools' | 'media'
}

export function getSystemHealth(system: 'tools' | 'media', signal?: AbortSignal): Promise<SystemHealth> {
  return request<SystemHealth>(`/${system}/health`, { signal })
}


export type AiSurface = 'blog' | 'studio' | 'tools'

export type AiProvider = 'openai' | 'grok' | 'gemini' | 'claude'

export interface AvailableModel {
  id: string
  name: string | null
  created: number | null
  context_window: number | null
}

export interface ProviderModels {
  provider: AiProvider
  models: AvailableModel[]
}

export function getProviderModels(token: string, provider: AiProvider): Promise<ProviderModels> {
  return request<ProviderModels>(`/llm/providers/${provider}/models`, { headers: authHeaders(token) })
}

export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiChatContext {
  route?: string
  section?: string
  page_type?: string
  post_id?: string
  title?: string
  excerpt?: string
  content_markdown?: string
  editor_status?: 'draft' | 'published'
  selected_text?: string
}

export interface AiChatRequest {
  surface: AiSurface
  messages: AiChatMessage[]
  context?: AiChatContext
  provider?: AiProvider
  model?: string
}

export type AiChatRunStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface AiChatRunCreated {
  id: string
  status: AiChatRunStatus
}

export interface AiChatRunSnapshot {
  id: string
  status: AiChatRunStatus
  content: string
  sequence: number
  error: string | null
}

export class AiChatRunTerminalError extends Error {}

export function createAiChatRun(token: string, chatRequest: AiChatRequest): Promise<AiChatRunCreated> {
  return request<AiChatRunCreated>('/ai/chat/runs', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(chatRequest),
  })
}

export function getAiChatRun(token: string, runId: string): Promise<AiChatRunSnapshot> {
  return request<AiChatRunSnapshot>(`/ai/chat/runs/${encodeURIComponent(runId)}`, {
    headers: authHeaders(token),
  })
}

export async function streamAiChatRun(
  token: string,
  runId: string,
  handlers: {
    onSnapshot: (content: string, sequence: number) => void
    onToken: (content: string, sequence: number) => void
  },
  signal?: AbortSignal,
): Promise<'completed' | 'disconnected'> {
  const response = await fetch(`${apiBaseUrl}/ai/chat/runs/${encodeURIComponent(runId)}/stream`, {
    headers: authHeaders(token),
    signal,
  })
  if (!response.ok || !response.body) {
    throw new AiChatRunTerminalError(`AI 续传失败：HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    if (done && buffer.trim()) {
      events.push(buffer)
      buffer = ''
    }
    for (const event of events) {
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      const payload = JSON.parse(data) as {
        type: string
        content?: string
        message?: string
        sequence?: number
      }
      const sequence = payload.sequence ?? 0
      if (payload.type === 'snapshot') handlers.onSnapshot(payload.content ?? '', sequence)
      if (payload.type === 'token' && payload.content) handlers.onToken(payload.content, sequence)
      if (payload.type === 'error') {
        throw new AiChatRunTerminalError(payload.message ?? 'AI 生成失败')
      }
      if (payload.type === 'done') return 'completed'
    }
    if (done) return 'disconnected'
  }
}

export async function streamAiChat(
  token: string,
  chatRequest: AiChatRequest,
  onToken: (content: string) => void,
): Promise<void> {
  const run = await createAiChatRun(token, chatRequest)
  let renderedContent = ''
  const result = await streamAiChatRun(token, run.id, {
    onSnapshot: (content) => {
      const delta = content.startsWith(renderedContent) ? content.slice(renderedContent.length) : content
      renderedContent = content
      if (delta) onToken(delta)
    },
    onToken: (content) => {
      renderedContent += content
      onToken(content)
    },
  })
  if (result === 'disconnected') throw new Error('AI 流式连接意外中断')
}
