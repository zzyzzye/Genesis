import { expect, it, vi } from 'vitest'
import { createModelCatalogCache } from '../src/lib/modelCatalogCache'

it('多个节点共享目录与在途请求，换用户隔离，主动刷新绕过缓存', async () => {
  const cache = createModelCatalogCache<string[]>()
  let finish!: (value: string[]) => void
  const load = vi.fn(() => new Promise<string[]>(resolve => { finish = resolve }))
  const first = cache('account-a', 'images', load)
  const second = cache('account-a', 'images', load, true)
  expect(load).toHaveBeenCalledTimes(1)
  finish(['image-model'])
  expect(await first).toEqual(await second)
  await cache('account-a', 'images', load)
  expect(load).toHaveBeenCalledTimes(1)
  const refresh = cache('account-a', 'images', load, true)
  finish(['new-model'])
  expect(await refresh).toEqual(['new-model'])
  const other = cache('account-b', 'images', load)
  finish(['other-model'])
  expect(await other).toEqual(['other-model'])
  expect(load).toHaveBeenCalledTimes(3)
})

it('失败请求释放占位，旧会话的延迟结果不能覆盖新用户目录', async () => {
  const cache = createModelCatalogCache<string>()
  let finish!: (value: string) => void
  const old = cache('old', 'text', () => new Promise(resolve => { finish = resolve }))
  await cache('new', 'text', () => Promise.resolve('new-model'))
  finish('old-model')
  await old
  expect(await cache('new', 'text', () => Promise.resolve('unexpected'))).toBe('new-model')
  await expect(cache('new', 'text', () => Promise.reject(new Error('offline')), true)).rejects.toThrow('offline')
  expect(await cache('new', 'text', () => Promise.resolve('recovered'), true)).toBe('recovered')
})
