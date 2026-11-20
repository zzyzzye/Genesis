import { afterEach, describe, expect, it, vi } from 'vitest'
import { journalImages, journalQuotes, journalSelectionKey, pickJournalScene, readPreviousJournalSelection, rememberJournalSelection } from '../src/features/blog/journalQuotes'

afterEach(() => { vi.restoreAllMocks(); window.localStorage.removeItem(journalSelectionKey) })

describe('随机首屏', () => {
  it('多次打开时图片和短句均不连续重复', () => {
    let previous = pickJournalScene(undefined, () => 0)
    for (let index = 0; index < 100; index += 1) {
      const next = pickJournalScene({ imageId: previous.image.id, quoteId: previous.quote.id }, () => (index % 10) / 10)
      expect(next.image.id).not.toBe(previous.image.id)
      expect(next.quote.id).not.toBe(previous.quote.id)
      previous = next
    }
  })

  it('可选中所有资源，旧资源标识不会破坏选择', () => {
    const images = new Set<string>()
    const quotes = new Set<string>()
    for (let index = 0; index < 360; index += 1) {
      const scene = pickJournalScene({ imageId: 'removed', quoteId: 'removed' }, () => index / 360)
      images.add(scene.image.id); quotes.add(scene.quote.id)
    }
    expect(images.size).toBe(journalImages.length)
    expect(quotes.size).toBe(journalQuotes.length)
  })

  it('保存上次选择，损坏或禁用的存储不阻断页面', () => {
    const selection = { imageId: 'coast', quoteId: 'clouds' }
    rememberJournalSelection(selection)
    expect(readPreviousJournalSelection()).toEqual(selection)
    window.localStorage.setItem(journalSelectionKey, '{invalid')
    expect(readPreviousJournalSelection()).toBeUndefined()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('存储已禁用') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('存储已禁用') })
    expect(readPreviousJournalSelection()).toBeUndefined()
    expect(() => rememberJournalSelection(selection)).not.toThrow()
  })
})
