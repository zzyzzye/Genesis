import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CommentContent } from '../src/features/blog/CommentContent'
import { commentStickers } from '../src/features/blog/commentStickers'

afterEach(cleanup)

describe('评论图片表情', () => {
  it('已知短码显示本地图片，未知短码、HTML 与图片链接保持原文', () => {
    const { container } = render(<p><CommentContent content={'你好[表情:开心]\n[表情:未知]<script>不执行</script>![远程](https://example.com/a.png)'} /></p>)
    expect(screen.getByRole('img', { name: '[表情:开心]' })).toHaveAttribute('src', '/images/comments/smile.png')
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('[表情:未知]<script>不执行</script>![远程](https://example.com/a.png)')
  })

  it('图片加载失败回退可读短码', () => {
    render(<CommentContent content="[表情:开心]" />)
    fireEvent.error(screen.getByRole('img', { name: '[表情:开心]' }))
    expect(screen.getByText('[表情:开心]')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('目录引用的图片全部存在且为 PNG，短码不重复', () => {
    expect(new Set(commentStickers.map(sticker => sticker.code)).size).toBe(commentStickers.length)
    for (const sticker of commentStickers) {
      const bytes = readFileSync(`public${sticker.src}`)
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    }
  })
})
