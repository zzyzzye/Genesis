import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearImageCache, invalidateImage, subscribeImage } from '../src/pages/media/imagePreview'
import * as api from '../src/pages/media/api'
import { accountAuthTokenKey, authTokenChangedEvent } from '../src/lib/auth'

const revoke = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached')
  revoke.mockClear()
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke)
  vi.spyOn(api, 'fileBlob').mockResolvedValue(new Blob(['image']))
})
afterEach(() => { clearImageCache(); vi.useRealTimers(); vi.restoreAllMocks() })

it('合并在途请求，卸载再挂载复用，闲置到期释放', async () => {
  const release = subscribeImage('a', 'session-a', vi.fn())
  release()
  const listener = vi.fn()
  const again = subscribeImage('a', 'session-a', listener)
  await Promise.resolve()
  expect(api.fileBlob).toHaveBeenCalledTimes(1)
  expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'blob:cached' }))
  again()
  vi.advanceTimersByTime(300_000)
  expect(revoke).toHaveBeenCalledTimes(1)
  subscribeImage('a', 'session-a', vi.fn())()
  expect(api.fileBlob).toHaveBeenCalledTimes(2)
})

it('原图、缩略图与不同账户独立，退出登录清理缓存', async () => {
  subscribeImage('a', 'session-a', vi.fn())()
  subscribeImage('a', 'session-a', vi.fn(), true)()
  subscribeImage('a', 'session-b', vi.fn(), true)()
  await Promise.resolve()
  expect(api.fileBlob).toHaveBeenCalledTimes(3)
  expect(api.fileBlob).toHaveBeenCalledWith({ id: 'a' }, expect.any(AbortSignal), true)
  window.dispatchEvent(new Event(authTokenChangedEvent))
  expect(revoke).toHaveBeenCalledTimes(3)
})

it('失败后重试，超过容量只淘汰闲置图片', async () => {
  vi.mocked(api.fileBlob).mockRejectedValueOnce(new Error('失败'))
  subscribeImage('failed', 'session', vi.fn())()
  await Promise.resolve(); await Promise.resolve()
  subscribeImage('failed', 'session', vi.fn())()
  await Promise.resolve()
  vi.mocked(api.fileBlob).mockResolvedValue({ size: 65 * 1024 * 1024 } as Blob)
  subscribeImage('large', 'session', vi.fn())()
  await Promise.resolve()
  expect(revoke).toHaveBeenCalledTimes(2)
})

it('手动重试重新读取，保留其他正在显示的旧预览', async () => {
  const release = subscribeImage('a', 'session', vi.fn())
  await Promise.resolve()
  invalidateImage('a', 'session')
  subscribeImage('a', 'session', vi.fn())()
  expect(api.fileBlob).toHaveBeenCalledTimes(2)
  expect(revoke).not.toHaveBeenCalled()
  release()
  expect(revoke).toHaveBeenCalledTimes(1)
})

it('其他标签页退出也清理当前页的私有图片', async () => {
  const listener = vi.fn()
  subscribeImage('a', 'session', listener)
  await Promise.resolve()
  window.dispatchEvent(new StorageEvent('storage', { key: accountAuthTokenKey }))
  expect(revoke).toHaveBeenCalledTimes(1)
  expect(listener).toHaveBeenLastCalledWith({ url: '', error: '' })
})
