export const accountAuthTokenKey = 'genesis-account-token'
export const studioAuthTokenKey = 'genesis-studio-token'

export function getStoredAuthToken(key: string = accountAuthTokenKey): string | null {
  return window.localStorage.getItem(key)
}

export function storeAuthToken(token: string, key: string = accountAuthTokenKey): void {
  window.localStorage.setItem(key, token)
}

export function clearStoredAuthToken(key: string = accountAuthTokenKey): void {
  window.localStorage.removeItem(key)
}
