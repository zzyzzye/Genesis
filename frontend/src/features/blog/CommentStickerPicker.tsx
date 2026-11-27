import { useLayoutEffect, useRef } from 'react'
import { commentStickers, type CommentSticker } from './commentStickers'
import { CommentStickerImage } from './CommentContent'

export function CommentStickerPicker({ id, onSelect, onClose }: { id: string; onSelect: (sticker: CommentSticker) => void; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    panel.current?.querySelector('button')?.focus({ preventScroll: true })
    panel.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, [])

  return <div ref={panel} id={id} className="comment-sticker-picker" role="group" aria-label="图片表情包" onKeyDown={event => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    const buttons = [...event.currentTarget.querySelectorAll('button')]
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const columns = getComputedStyle(event.currentTarget).gridTemplateColumns.split(' ').length
    const next = event.key === 'ArrowRight' ? current + 1 : event.key === 'ArrowLeft' ? current - 1 : event.key === 'ArrowDown' ? current + columns : event.key === 'ArrowUp' ? current - columns : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null
    if (next !== null) { event.preventDefault(); buttons[(next + buttons.length) % buttons.length]?.focus() }
  }}>
    {commentStickers.map(sticker => <button key={sticker.id} type="button" aria-label={sticker.label} title={sticker.label} onClick={() => onSelect(sticker)}><CommentStickerImage sticker={sticker} decorative /></button>)}
  </div>
}
