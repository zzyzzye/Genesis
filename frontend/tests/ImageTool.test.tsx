import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageTool } from '../src/pages/toolbox/ImageTool'
import * as processing from '../src/pages/toolbox/imageProcessing'
import * as download from '../src/lib/download'

vi.mock('../src/pages/toolbox/imageProcessing', async importOriginal => ({ ...await importOriginal<typeof processing>(), validateImage: vi.fn(), encodeImage: vi.fn() }))
const bitmap = { width: 400, height: 200, close: vi.fn() }
const createUrl = vi.fn(() => 'blob:preview')
const revokeUrl = vi.fn()
function select() { fireEvent.change(screen.getByLabelText('选择图片文件'), { target: { files: [new File(['original'], '示例.png', { type: 'image/png' })] } }) }
beforeEach(() => {
  vi.mocked(processing.validateImage).mockResolvedValue()
  vi.mocked(processing.encodeImage).mockResolvedValue({ blob: new Blob(['ok'], { type: 'image/webp' }), width: 400, height: 200 })
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
  vi.spyOn(URL, 'createObjectURL').mockImplementation(createUrl)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeUrl)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('图片转换与压缩工具', () => {
  it('无需登录，转换后可下载；改参数立即失效旧结果', async () => {
    const save = vi.spyOn(download, 'downloadBlob').mockImplementation(() => {})
    render(<MemoryRouter><ImageTool /></MemoryRouter>)
    expect(screen.getByRole('button', { name: '转换并压缩' })).toBeDisabled()
    select(); await screen.findByAltText('原图预览')
    fireEvent.click(screen.getByRole('button', { name: '转换并压缩' }))
    fireEvent.click(await screen.findByRole('button', { name: '下载图片' }))
    expect(save).toHaveBeenCalledWith(expect.any(Blob), '示例-converted.webp')
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    expect(screen.queryByRole('button', { name: '下载图片' })).not.toBeInTheDocument()
    expect(screen.getByRole('slider')).toBeDisabled()
  })
  it('无效尺寸阻止编码，失败保留原图与设置并支持重试', async () => {
    render(<MemoryRouter><ImageTool /></MemoryRouter>)
    select(); await screen.findByAltText('原图预览')
    fireEvent.change(screen.getByLabelText('最长边（像素）'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '转换并压缩' }))
    expect(processing.encodeImage).not.toHaveBeenCalled()
    expect(screen.getByLabelText('最长边（像素）')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('最长边（像素）'), { target: { value: '100' } })
    vi.mocked(processing.encodeImage).mockRejectedValueOnce(new Error('编码失败'))
    fireEvent.click(screen.getByRole('button', { name: '转换并压缩' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('编码失败')
    expect(screen.getByAltText('原图预览')).toBeInTheDocument()
    expect(screen.getByLabelText('最长边（像素）')).toHaveValue(100)
    fireEvent.click(screen.getByRole('button', { name: '转换并压缩' }))
    expect(await screen.findByRole('button', { name: '下载图片' })).toBeEnabled()
  })
  it('拒绝损坏文件，卸载时关闭解码图片并释放预览', async () => {
    const view = render(<MemoryRouter><ImageTool /></MemoryRouter>)
    vi.mocked(processing.validateImage).mockRejectedValueOnce(new Error('文件损坏'))
    select(); expect(await screen.findByRole('alert')).toHaveTextContent('文件损坏')
    select(); await screen.findByAltText('原图预览')
    view.unmount()
    expect(bitmap.close).toHaveBeenCalled()
    expect(revokeUrl).toHaveBeenCalledWith('blob:preview')
  })
  it('离开页面后不接收迟到的解码结果', async () => {
    let resolve!: (value: typeof bitmap) => void
    vi.mocked(createImageBitmap).mockImplementation(() => new Promise(done => { resolve = done }))
    const view = render(<MemoryRouter><ImageTool /></MemoryRouter>)
    select(); await waitFor(() => expect(createImageBitmap).toHaveBeenCalled())
    view.unmount(); resolve(bitmap)
    await waitFor(() => expect(bitmap.close).toHaveBeenCalled())
    expect(createUrl).not.toHaveBeenCalled()
  })
})
