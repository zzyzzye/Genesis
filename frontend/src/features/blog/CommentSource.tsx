import { useState } from 'react'
import type { BlogComment } from '../../lib/api'
import './CommentSource.css'

export function CommentAvatar({ item }: { item: BlogComment }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return <span className="comment-avatar" aria-hidden="true">
    {item.avatar_url && failedUrl !== item.avatar_url
      ? <img src={item.avatar_url} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(item.avatar_url ?? null)} />
      : <span>{Array.from(item.author_name)[0] || '访'}</span>}
  </span>
}

export function CommentSource({ item }: { item: BlogComment }) {
  return <span className="comment-source" aria-label="评论来源">
    <span>{item.region || '未知地区'}</span>
    <span>{item.browser || '未知浏览器'} · {item.operating_system || '未知系统'}</span>
  </span>
}
