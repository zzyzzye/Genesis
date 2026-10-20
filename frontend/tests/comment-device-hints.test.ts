import { afterEach, expect, it, vi } from 'vitest'
import { submitBlogComment } from '../src/lib/api'
import { collectCommentDeviceHints } from '../src/lib/commentDeviceHints'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('只请求版本字段，忽略伪品牌与无关设备信息，并随评论提交', async () => {
  const getHighEntropyValues = vi.fn().mockResolvedValue({
    platformVersion: '15.0.0', model: '不应提交', architecture: '不应提交',
    fullVersionList: [
      { brand: 'Not A Brand', version: '99.0.0.0' },
      { brand: 'Google Chrome', version: '132.0.6834.110', extra: '不应提交' },
      { brand: 'Chromium', version: 'invalid' },
    ],
  })
  vi.stubGlobal('navigator', { userAgentData: { platform: 'Windows', getHighEntropyValues } })
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'receipt', state: 'pending' })))
  vi.stubGlobal('fetch', fetcher)
  await expect(submitBlogComment('文章', 'test-placeholder', '评论', 'stable-id')).resolves.toMatchObject({ state: 'pending' })
  expect(getHighEntropyValues).toHaveBeenCalledWith(['platformVersion', 'fullVersionList'])
  expect(fetcher).toHaveBeenCalledWith('/api/v1/blog/posts/%E6%96%87%E7%AB%A0/comments', expect.objectContaining({
    body: JSON.stringify({ content: '评论', submission_id: 'stable-id', qq: null, show_region: false,
      device_hints: { platform: 'Windows', platform_version: '15.0.0', full_version_list: [{ brand: 'Google Chrome', version: '132.0.6834.110' }] } }),
  }))
})

it.each([{}, { userAgentData: {} }, { userAgentData: { getHighEntropyValues: () => Promise.reject(new Error('拒绝')) } }])('不支持或被拒绝仍提交原评论', async navigatorValue => {
  vi.stubGlobal('navigator', navigatorValue)
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'receipt', state: 'pending' })))
  vi.stubGlobal('fetch', fetcher)
  await submitBlogComment('post', 'test-placeholder', '评论', 'stable-id')
  expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    body: JSON.stringify({ content: '评论', submission_id: 'stable-id', qq: null, show_region: false }),
  }))
})

it('版本接口没有响应时最多等 400 毫秒，不阻塞提交', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('navigator', { userAgentData: { getHighEntropyValues: () => new Promise(() => {}) } })
  const promise = collectCommentDeviceHints()
  await vi.advanceTimersByTimeAsync(400)
  expect(await promise).toBeUndefined()
})

it('过滤无效系统版本，不用品牌低熵版本冒充完整版本', async () => {
  vi.stubGlobal('navigator', { userAgentData: { platform: 'Android', getHighEntropyValues: () => Promise.resolve({ platformVersion: 'unknown', brands: [{ brand: 'Google Chrome', version: '132' }] }) } })
  expect(await collectCommentDeviceHints()).toEqual({ platform: 'Android', full_version_list: [] })
})
