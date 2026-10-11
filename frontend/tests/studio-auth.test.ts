import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleStudioUnauthorized, storeAuthToken, studioAuthTokenKey, studioSessionExpiredEvent } from '../src/lib/auth'
import { getAdminBlogPosts, login } from '../src/lib/api'
import { listAttachments, uploadAttachment } from '../src/lib/attachments'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('工作台会话失效', () => {
  it('只处理当前会话的 401，忽略旧会话、403、网络失败与未认证请求', () => {
    storeAuthToken('current-test-token', studioAuthTokenKey)
    const expired = vi.fn()
    window.addEventListener(studioSessionExpiredEvent, expired)
    try {
      handleStudioUnauthorized(401, { Authorization: 'Bearer stale-test-token' })
      handleStudioUnauthorized(403, { Authorization: 'Bearer current-test-token' })
      handleStudioUnauthorized(503, { Authorization: 'Bearer current-test-token' })
      handleStudioUnauthorized(401)
      expect(expired).not.toHaveBeenCalled()
      handleStudioUnauthorized(401, { Authorization: 'Bearer current-test-token' })
      handleStudioUnauthorized(401, { Authorization: 'Bearer current-test-token' })
      expect(expired).toHaveBeenCalledTimes(1)
      expect(localStorage.getItem(studioAuthTokenKey)).toBeNull()
    } finally { window.removeEventListener(studioSessionExpiredEvent, expired) }
  })

  it.each(['普通接口', '附件列表', '附件上传'])('%s 的 401 均触发统一失效事件', async kind => {
    storeAuthToken('current-test-token', studioAuthTokenKey)
    const expired = vi.fn()
    window.addEventListener(studioSessionExpiredEvent, expired)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"detail":"登录已过期"}', { status: 401 }))
    try {
      let request: Promise<unknown>
      if (kind === '普通接口') request = getAdminBlogPosts('current-test-token')
      else if (kind === '附件列表') request = listAttachments('current-test-token', null, '', 1)
      else {
        class RejectedXHR {
          status = 401
          responseText = '{"detail":"登录已过期"}'
          upload = {}
          onload?: () => void
          open() {}
          setRequestHeader() {}
          send() { queueMicrotask(() => this.onload?.()) }
        }
        vi.stubGlobal('XMLHttpRequest', RejectedXHR)
        request = uploadAttachment('current-test-token', 'test-id', new File([], 'test.bin'), null, 'test.bin', vi.fn(), new AbortController().signal)
      }
      await expect(request).rejects.toMatchObject({ status: 401 })
      expect(expired).toHaveBeenCalledTimes(1)
    } finally { window.removeEventListener(studioSessionExpiredEvent, expired) }
  })

  it('登录密码错误不清除另一个有效作者会话', async () => {
    storeAuthToken('current-test-token', studioAuthTokenKey)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }))
    await expect(login('test-author', 'test-password')).rejects.toMatchObject({ status: 401 })
    expect(localStorage.getItem(studioAuthTokenKey)).toBe('current-test-token')
  })
})
