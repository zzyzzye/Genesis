/** 目录请求在同一登录会话内共享；页面卸载不取消其他节点正在等的请求。 */
export function createModelCatalogCache<T>() {
  let identity: string | null = null
  const values = new Map<string, { value: T; at: number }>()
  const pending = new Map<string, Promise<T>>()
  return (token: string, key: string, load: () => Promise<T>, refresh = false): Promise<T> => {
    if (!token) return load()
    if (identity !== token) {
      identity = token
      values.clear()
      pending.clear()
    }
    const cached = values.get(key)
    if (!refresh && cached && Date.now() - cached.at < 60_000) return Promise.resolve(cached.value)
    const active = pending.get(key)
    if (active) return active
    const request = load().then((value) => {
      if (identity === token) values.set(key, { value, at: Date.now() })
      return value
    }).finally(() => {
      if (pending.get(key) === request) pending.delete(key)
    })
    pending.set(key, request)
    return request
  }
}
