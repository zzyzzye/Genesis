import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadBlob } from '../src/lib/download'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('私有文件下载资源', () => {
  it('仅创建临时 blob 链接，发起后移除节点，延迟释放地址', () => {
    vi.useFakeTimers()
    const NativeURL = URL
    const create = vi.fn(() => 'blob:preview-download')
    const revoke = vi.fn()
    vi.stubGlobal('URL', class extends NativeURL { static createObjectURL = create; static revokeObjectURL = revoke })
    let filename = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true)
      expect(this.href).toBe('blob:preview-download')
      filename = this.download
    })
    const blob = new Blob(['原始 Markdown'])
    downloadBlob(blob, 'article.md')
    expect(create).toHaveBeenCalledWith(blob)
    expect(filename).toBe('article.md')
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_000)
    expect(revoke).toHaveBeenCalledWith('blob:preview-download')
  })
})
