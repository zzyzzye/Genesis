import { useState } from 'react'
import { Globe } from 'lucide-react'
import type { BlogComment } from '../../lib/api'
import { CommentDeviceIcon } from './CommentDeviceIcon'
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
  if (!item.region && !item.browser && !item.operating_system) return null
  return <span className="comment-source" aria-label="评论来源">
    {item.region && <span><Globe size={12} aria-hidden="true" />{item.region}</span>}
    {item.operating_system && <span className="comment-source__device"><CommentDeviceIcon kind="system" name={item.operating_system} /><span>{item.operating_system}</span></span>}
    {item.browser && <span className="comment-source__device"><CommentDeviceIcon kind="browser" name={item.browser} /><span>{item.browser}</span></span>}
  </span>
}
