import { StrictMode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlogHero } from '../src/features/blog/BlogHero'
import { journalSelectionKey } from '../src/features/blog/journalQuotes'

afterEach(() => { vi.restoreAllMocks(); window.localStorage.removeItem(journalSelectionKey) })

function open() { return render(<StrictMode><MemoryRouter><BlogHero /></MemoryRouter></StrictMode>) }

describe('博客首屏', () => {
  it('严格模式下重新进入仍会更换图片和短句', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    window.localStorage.removeItem(journalSelectionKey)
    const first = open()
    const previous = JSON.parse(window.localStorage.getItem(journalSelectionKey)!) as { imageId: string; quoteId: string }
    first.unmount()
    open()
    const next = JSON.parse(window.localStorage.getItem(journalSelectionKey)!) as { imageId: string; quoteId: string }
    expect(next.imageId).not.toBe(previous.imageId)
    expect(next.quoteId).not.toBe(previous.quoteId)
  })

  it('图片失败回退到森林，再次失败仍保留短句和入口', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const { container } = open()
    fireEvent.error(container.querySelector('.blog-hero-image')!)
    expect(container.querySelector('.blog-hero-image')).toHaveAttribute('src', '/images/blog/forest.jpg')
    fireEvent.error(container.querySelector('.blog-hero-image')!)
    expect(container.querySelector('.blog-hero-image')).not.toBeInTheDocument()
    expect(container.querySelector('blockquote')).not.toBeEmptyDOMElement()
    expect(screen.getByRole('link', { name: '向下阅读' })).toBeInTheDocument()
    expect(screen.getByTitle('查看原文出处（新窗口）')).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
