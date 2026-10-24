export const accountAuthTokenKey = 'genesis-account-token'
export const studioAuthTokenKey = 'genesis-studio-token'
export const studioSessionExpiredEvent = 'genesis:studio-session-expired'
export const authTokenChangedEvent = 'genesis:auth-token-changed'
const sessionUsers = new Map<string, string>()
const refreshes = new Map<string, Promise<string | null>>()
const authBase = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
const tokenKeys = [accountAuthTokenKey, studioAuthTokenKey]

class AuthSessionError extends Error {
  readonly status = 401

  constructor() { super('登录状态已过期，请重新登录') }
}

function claims(token: string): { sid: string; sub: string; exp: number } | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const value = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
    return typeof value.sid === 'string' && typeof value.sub === 'string' && typeof value.exp === 'number'
      ? { sid:value.sid, sub:value.sub, exp:value.exp } : null
  } catch { return null }
}

export function latestAuthToken(token: string): string {
  const previous = claims(token)
  if (!previous) return token
  let latest = token
  let expires = previous.exp
  // 作者工作台与账户可以共享同一会话，也可以是不同账号，不能互相覆盖。
  for (const key of tokenKeys) {
    const stored = getStoredAuthToken(key)
    const value = stored ? claims(stored) : null
    if (stored && value?.sid === previous.sid && value.sub === previous.sub
      && (value.exp > expires || (latest === token && stored !== token && value.exp === expires))) {
      latest = stored
      expires = value.exp
    }
  }
  return latest
}

export async function refreshAuthToken(token: string, force = false): Promise<string | null> {
  const current = latestAuthToken(token)
  if (current !== token) return current
  const value = claims(token)
  if (!value || !tokenKeys.some(key => getStoredAuthToken(key) === token)) return token
  if (!force && value.exp * 1000 - Date.now() > 5 * 60_000) return token
  const pending = refreshes.get(token)
  if (pending) return pending
  const refresh = async () => {
    const latest = latestAuthToken(token)
    if (latest !== token) return latest
    if (!tokenKeys.some(key => getStoredAuthToken(key) === token)) return null
    const response = await fetch(`${authBase}/auth/refresh`, { method:'POST', credentials:'include', headers:{ Authorization:`Bearer ${token}` } })
    if (response.status === 401 || response.status === 403) {
      handleStudioUnauthorized(401, { Authorization:`Bearer ${token}` })
      return null
    }
    if (!response.ok) throw new Error('登录续期暂不可用，请稍后重试')
    const data = await response.json() as { access_token?: string }
    const next = data.access_token ? claims(data.access_token) : null
    if (!data.access_token || next?.sid !== value.sid || next.sub !== value.sub) throw new Error('登录续期响应无效，请重试')
    const keys = tokenKeys.filter(key => getStoredAuthToken(key) === token)
    if (!keys.length) return null
    const user = sessionUsers.get(token)
    for (const key of keys) window.localStorage.setItem(key, data.access_token)
    if (user) sessionUsers.set(data.access_token, user)
    window.dispatchEvent(new Event(authTokenChangedEvent))
    return data.access_token
  }
  // 同一标签页合并请求；支持 Web Locks 时，同源标签页也串行轮换 Cookie。
  const work = (navigator.locks ? navigator.locks.request(`genesis-refresh:${value.sid}`, refresh) : refresh())
    .finally(() => refreshes.delete(token))
  refreshes.set(token, work)
  return work
}

export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  init.signal?.throwIfAborted()
  const headers = new Headers(init.headers)
  const authorization = headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return fetch(url, init)
  const original = authorization.slice(7)
  let token = await refreshAuthToken(original)
  init.signal?.throwIfAborted()
  if (!token) throw new AuthSessionError()
  headers.set('Authorization', `Bearer ${token}`)
  let response = await fetch(url, token === original ? init : { ...init, headers })
  if (response.status === 401 && claims(token)) {
    const next = await refreshAuthToken(token, true)
    init.signal?.throwIfAborted()
    if (next) {
      token = next
      headers.set('Authorization', `Bearer ${token}`)
      response = await fetch(url, { ...init, headers })
    }
  }
  handleStudioUnauthorized(response.status, headers)
  return response
}

export async function authUpload(url: string, token: string, body: FormData, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<XMLHttpRequest> {
  signal?.throwIfAborted()
  const send = (current: string) => new Promise<XMLHttpRequest>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('已停止上传', 'AbortError')); return }
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const cleanup = () => signal?.removeEventListener('abort', abort)
    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${current}`)
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100))) }
    xhr.onload = () => { cleanup(); resolve(xhr) }
    xhr.onerror = () => { cleanup(); reject(new Error('网络中断，请重试核对上传结果')) }
    xhr.onabort = () => { cleanup(); reject(new DOMException('已停止等待，可重试核对上传结果', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once:true })
    xhr.send(body)
  })
  let current = await refreshAuthToken(token)
  if (!current) throw new AuthSessionError()
  let response = await send(current)
  if (response.status === 401 && claims(current)) {
    const next = await refreshAuthToken(current, true)
    if (next) { current = next; response = await send(current) }
  }
  handleStudioUnauthorized(response.status, { Authorization:`Bearer ${current}` })
  return response
}

export async function logoutAuthSession(token: string | null): Promise<void> {
  if (!token) return
  const current = latestAuthToken(token)
  if (!claims(current)) return
  for (const key of tokenKeys) if (getStoredAuthToken(key) === current) clearStoredAuthToken(key)
  window.dispatchEvent(new Event(authTokenChangedEvent))
  await fetch(`${authBase}/auth/logout`, { method:'POST', credentials:'include', headers:{ Authorization:`Bearer ${current}` } }).catch(() => {})
}

export function rememberSessionUser(token: string, userId: string): void {
  for (const stored of sessionUsers.keys()) {
    if (stored !== getStoredAuthToken() && stored !== getStoredAuthToken(studioAuthTokenKey)) sessionUsers.delete(stored)
  }
  if (token === getStoredAuthToken() || token === getStoredAuthToken(studioAuthTokenKey)) sessionUsers.set(token, userId)
}

export function handleStudioUnauthorized(status: number, headers?: HeadersInit): void {
  if (status !== 401) return
  const authorization = new Headers(headers).get('Authorization')
  // 只失效本次请求使用的会话，避免旧请求登出刚完成的新登录。
  const keys = [accountAuthTokenKey, studioAuthTokenKey].filter((key) => {
    const stored = getStoredAuthToken(key)
    return stored && authorization === `Bearer ${stored}`
  })
  if (!keys.length) return
  const userId = sessionUsers.get(authorization!.slice('Bearer '.length))
  keys.forEach(clearStoredAuthToken)
  window.dispatchEvent(new CustomEvent(studioSessionExpiredEvent, { cancelable: true, detail: { userId } }))
}

export function getStoredAuthToken(key: string = accountAuthTokenKey): string | null {
  return window.localStorage.getItem(key)
}

export function storeAuthToken(token: string, key: string = accountAuthTokenKey): void {
  window.localStorage.setItem(key, token)
  window.dispatchEvent(new Event(authTokenChangedEvent))
}

export function clearStoredAuthToken(key: string = accountAuthTokenKey): void {
  window.localStorage.removeItem(key)
}
