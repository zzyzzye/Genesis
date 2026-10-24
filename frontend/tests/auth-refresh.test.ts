import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  accountAuthTokenKey, authFetch, authUpload, getStoredAuthToken, latestAuthToken,
  logoutAuthSession, refreshAuthToken, storeAuthToken, studioAuthTokenKey, studioSessionExpiredEvent,
} from '../src/lib/auth'

// 合成令牌只验证浏览器协议，签名与权限由后端测试覆盖。
function token(seconds: number, sid = 'test-session', sub = 'test-user') {
  return `test.${btoa(JSON.stringify({ sid, sub, exp: Math.floor(Date.now() / 1000) + seconds }))}.test`
}
function saved(value: string, shared = false) {
  storeAuthToken(value)
  if (shared) storeAuthToken(value, studioAuthTokenKey)
  return value
}
function auth(value: string): RequestInit { return { headers:{ Authorization:`Bearer ${value}` } } }
function renewed(value: string) { return new Response(JSON.stringify({ access_token:value }), { status:200 }) }
function isRefresh(url: string | URL | Request) {
  return (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith('/auth/refresh')
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('一天会话自动续期', () => {
  it('有效期充足不续期，临近到期的并发读取只刷新一次并同步共享会话', async () => {
    const old = saved(token(60), true)
    const next = token(86400)
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(url => Promise.resolve(isRefresh(url)
      ? renewed(next) : new Response('{}')))
    await Promise.all([authFetch('/one', auth(old)), authFetch('/two', auth(old))])
    expect(request.mock.calls.filter(([url]) => isRefresh(url))).toHaveLength(1)
    expect(getStoredAuthToken()).toBe(next)
    expect(getStoredAuthToken(studioAuthTokenKey)).toBe(next)
    for (const [, init] of request.mock.calls.filter(([url]) => !isRefresh(url))) {
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${next}`)
    }
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method:'POST', credentials:'include' })
    request.mockClear()
    await authFetch('/still-current', auth(old))
    expect(request).toHaveBeenCalledTimes(1)
    expect(latestAuthToken(old)).toBe(next)
    expect(await refreshAuthToken(next)).toBe(next)
  })

  it('401 后轮换并最多重试一次，保留原写入正文和取消信号', async () => {
    const old = saved(token(86400))
    const next = token(86401)
    const controller = new AbortController()
    const body = JSON.stringify({ title:'保留原草稿' })
    const request = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status:401 }))
      .mockResolvedValueOnce(renewed(next))
      .mockResolvedValueOnce(new Response('{}', { status:401 }))
    const expired = vi.fn()
    window.addEventListener(studioSessionExpiredEvent, expired)
    try {
      expect((await authFetch('/write', { ...auth(old), method:'PUT', body, signal:controller.signal })).status).toBe(401)
      expect(request).toHaveBeenCalledTimes(3)
      expect(request.mock.calls[2]?.[1]).toMatchObject({ method:'PUT', body, signal:controller.signal })
      expect(expired).toHaveBeenCalledTimes(1)
      expect(getStoredAuthToken()).toBeNull()
    } finally { window.removeEventListener(studioSessionExpiredEvent, expired) }
  })

  it.each([503, 403])('%s 不重复发送写请求，也不清除有效登录', async status => {
    const current = saved(token(86400))
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status }))
    expect((await authFetch('/write', { ...auth(current), method:'POST', body:'draft' })).status).toBe(status)
    expect(request).toHaveBeenCalledTimes(1)
    expect(getStoredAuthToken()).toBe(current)
  })

  it('刷新被拒绝才清除对应会话；另一个账号不受影响', async () => {
    const current = saved(token(60))
    const author = token(86400, 'other-session', 'other-user')
    storeAuthToken(author, studioAuthTokenKey)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status:401 }))
    await expect(authFetch('/private', auth(current))).rejects.toMatchObject({ status:401 })
    expect(getStoredAuthToken()).toBeNull()
    expect(getStoredAuthToken(studioAuthTokenKey)).toBe(author)
  })

  it.each(['503', 'network', 'mismatched'])('刷新 %s 保留会话，不误登出或提交正文', async kind => {
    const current = saved(token(60), true)
    const request = vi.spyOn(globalThis, 'fetch')
    if (kind === 'network') request.mockRejectedValue(new TypeError('测试网络错误'))
    else request.mockResolvedValue(kind === '503' ? new Response('{}', { status:503 }) : renewed(token(86400, 'wrong-session')))
    await expect(authFetch('/write', { ...auth(current), method:'POST', body:'draft' })).rejects.toBeInstanceOf(Error)
    expect(request).toHaveBeenCalledTimes(1)
    expect(getStoredAuthToken()).toBe(current)
    expect(getStoredAuthToken(studioAuthTokenKey)).toBe(current)
  })

  it('退出期间完成的续期不能恢复旧会话，也不能覆盖刚登录的另一个账号', async () => {
    const old = saved(token(60), true)
    const pending = deferred<Response>()
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => isRefresh(url)
      ? pending.promise : new Response(null, { status:204 }))
    const refresh = refreshAuthToken(old)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await logoutAuthSession(old)
    const other = saved(token(86400, 'new-session', 'new-user'))
    pending.resolve(renewed(token(86400)))
    expect(await refresh).toBeNull()
    expect(getStoredAuthToken()).toBe(other)
    expect(getStoredAuthToken(studioAuthTokenKey)).toBeNull()
    expect(request.mock.calls[1]).toEqual(['/api/v1/auth/logout', expect.objectContaining({ credentials:'include', method:'POST' })])
  })

  it('同源锁内重新检查其他标签页已经换发的令牌', async () => {
    const old = saved(token(60))
    const next = token(86400)
    const lock = vi.fn(async (_name: string, work: () => Promise<string | null>) => {
      localStorage.setItem(accountAuthTokenKey, next)
      return work()
    })
    vi.stubGlobal('navigator', { locks:{ request:lock } })
    const request = vi.spyOn(globalThis, 'fetch')
    expect(await refreshAuthToken(old)).toBe(next)
    expect(lock).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalled()
  })

  it('附件 XHR 在 401 后续期一次，正文与进度回调保留', async () => {
    const old = saved(token(86400))
    const next = token(86401)
    const headers: string[] = []
    const bodies: FormData[] = []
    const statuses = [401, 201]
    class UploadXHR {
      status = statuses.shift()!
      upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
      onload?: () => void
      open() {}
      setRequestHeader(_key: string, value: string) { headers.push(value) }
      send(body: FormData) {
        bodies.push(body)
        queueMicrotask(() => { this.upload.onprogress?.({ lengthComputable:true, loaded:1, total:2 }); this.onload?.() })
      }
    }
    vi.stubGlobal('XMLHttpRequest', UploadXHR)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(renewed(next))
    const body = new FormData()
    const progress = vi.fn()
    expect((await authUpload('/upload', old, body, progress)).status).toBe(201)
    expect(headers).toEqual([`Bearer ${old}`, `Bearer ${next}`])
    expect(bodies).toEqual([body, body])
    expect(progress).toHaveBeenLastCalledWith(50)
  })

  it('已经取消的读取和上传不发起续期或传输', async () => {
    const old = saved(token(60))
    const controller = new AbortController()
    controller.abort()
    const request = vi.spyOn(globalThis, 'fetch')
    await expect(authFetch('/private', { ...auth(old), signal:controller.signal })).rejects.toMatchObject({ name:'AbortError' })
    await expect(authUpload('/upload', old, new FormData(), vi.fn(), controller.signal)).rejects.toMatchObject({ name:'AbortError' })
    expect(request).not.toHaveBeenCalled()
  })
})
