export const accountAuthTokenKey = 'genesis-account-token'
export const studioAuthTokenKey = 'genesis-studio-token'
export const studioSessionExpiredEvent = 'genesis:studio-session-expired'
export const authTokenChangedEvent = 'genesis:auth-token-changed'
const sessionUsers = new Map<string, string>()

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
