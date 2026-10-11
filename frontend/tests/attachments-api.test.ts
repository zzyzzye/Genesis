import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadAttachment } from '../src/lib/attachments'

class TestXHR {
  static current: TestXHR
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
  status = 201
  responseText = '{"id":"upload-1"}'
  onload?: () => void
  onerror?: () => void
  onabort?: () => void
  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn<(body: FormData) => void>()
  abort = vi.fn(() => this.onabort?.())
  constructor() { TestXHR.current = this }
}
afterEach(() => vi.unstubAllGlobals())
describe('附件上传传输', () => {
  it('使用真实 multipart 字段与相对路径，进度不会提前当作保存成功', async () => {
    vi.stubGlobal('XMLHttpRequest', TestXHR)
    const controller = new AbortController()
    const progress = vi.fn()
    const uploaded = new File(['bytes'], 'binary.any')
    const promise = uploadAttachment('test-placeholder', 'upload-1', uploaded, 'folder-1', '目录/binary.any', progress, controller.signal)
    const xhr = TestXHR.current
    expect(xhr.open).toHaveBeenCalledWith('POST', '/api/v1/admin/blog/attachments/files')
    const form = xhr.send.mock.calls[0]?.[0] as FormData
    expect(form.get('id')).toBe('upload-1')
    expect(form.get('relative_path')).toBe('目录/binary.any')
    expect(form.get('parent_id')).toBe('folder-1')
    expect(form.get('file')).toBe(uploaded)
    let done = false
    void promise.then(() => { done = true })
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 20, total: 20 })
    await Promise.resolve()
    expect(progress).toHaveBeenCalledWith(100)
    expect(done).toBe(false)
    xhr.onload?.()
    expect(await promise).toMatchObject({ id: 'upload-1' })
    controller.abort()
    expect(xhr.abort).not.toHaveBeenCalled()
  })

  it('服务器拒绝、网络中断和停止分别返回持续可识别的错误', async () => {
    vi.stubGlobal('XMLHttpRequest', TestXHR)
    const upload = (controller = new AbortController()) => uploadAttachment('test-placeholder', 'upload-1', new File([], 'empty.bin'), null, 'empty.bin', vi.fn(), controller.signal)
    const rejected = upload()
    TestXHR.current.status = 409; TestXHR.current.responseText = '{"detail":"同名文件已存在"}'; TestXHR.current.onload?.()
    await expect(rejected).rejects.toMatchObject({ status: 409, message: expect.stringContaining('同名文件已存在') as unknown })
    const offline = upload(); TestXHR.current.onerror?.()
    await expect(offline).rejects.toThrow('网络中断')
    const controller = new AbortController()
    const stopped = upload(controller); controller.abort()
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' })
    expect(TestXHR.current.abort).toHaveBeenCalledTimes(1)
    const invalid = upload(); TestXHR.current.responseText = 'invalid'; TestXHR.current.onload?.()
    await expect(invalid).rejects.toThrow('回执无法解析')
    controller.abort()
    await expect(upload(controller)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
