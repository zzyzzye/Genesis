import { Fragment, useState } from 'react'
import { commentStickerByCode, type CommentSticker } from './commentStickers'
import './CommentStickers.css'

export function CommentStickerImage({ sticker, decorative = false }: { sticker: CommentSticker; decorative?: boolean }) {
  const [failed, setFailed] = useState(false)
  return failed
    ? <span className="comment-sticker-fallback" aria-hidden={decorative || undefined}>{sticker.code}</span>
    : <img className="comment-sticker" src={sticker.src} alt={decorative ? '' : sticker.code} title={sticker.label} width={32} height={32} loading="lazy" draggable={false} onError={() => setFailed(true)} />
}

/** 评论保持纯文本语义，不解析 HTML、Markdown 或用户提供的图片地址。 */
export function CommentContent({ content }: { content: string }) {
  return <>{content.split(/(\[表情:[^\]\n]{1,16}\])/g).map((part, index) => {
    const sticker = commentStickerByCode.get(part)
    return <Fragment key={index}>{sticker ? <CommentStickerImage key={sticker.id} sticker={sticker} /> : part}</Fragment>
  })}</>
}
