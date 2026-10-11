export const accountAuthTokenKey = 'genesis-account-token'
export const studioAuthTokenKey = 'genesis-studio-token'
export const studioSessionExpiredEvent = 'genesis:studio-session-expired'

export function handleStudioUnauthorized(status: number, headers?: HeadersInit): void {
  if (status !== 401) return
  const authorization = new Headers(headers).get('Authorization')
  const stored = getStoredAuthToken(studioAuthTokenKey)
  // 只失效本次请求使用的会话，避免旧请求登出刚完成的新登录。
  if (!stored || authorization !== `Bearer ${stored}`) return
  clearStoredAuthToken(studioAuthTokenKey)
  window.dispatchEvent(new Event(studioSessionExpiredEvent))
}

export function getStoredAuthToken(key: string = accountAuthTokenKey): string | null {
  return window.localStorage.getItem(key)
}

export function storeAuthToken(token: string, key: string = accountAuthTokenKey): void {
  window.localStorage.setItem(key, token)
}

export function clearStoredAuthToken(key: string = accountAuthTokenKey): void {
  window.localStorage.removeItem(key)
}
