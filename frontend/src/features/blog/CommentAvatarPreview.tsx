import { useEffect, useState } from 'react'
import { LoaderCircle, Mail, RotateCw } from 'lucide-react'
import { previewCommentAvatar } from '../../lib/api'

export function CommentAvatarPreview({ qq, token }: { qq: string; token: string }) {
  const number = qq.trim().match(/^([1-9][0-9]{4,10})(?:@qq\.com)?$/i)?.[1]
  return number
    ? <AvatarRequest key={`${token}:${number}`} number={number} token={token} />
    : <span className="comment-avatar-preview" aria-hidden="true"><Mail size={18} /></span>
}

function AvatarRequest({ number, token }: { number: string; token: string }) {
  const [attempt, setAttempt] = useState(0)
  const [image, setImage] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    // 停止输入后再查询；切换邮箱或离开页面时取消旧请求并释放图片。
    const timer = window.setTimeout(() => {
      void previewCommentAvatar(token, number, controller.signal).then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setImage(objectUrl)
      }).catch(() => {
        if (!controller.signal.aborted) setStatus('error')
      })
    }, 450)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [number, token, attempt])

  if (status === 'error') return <button type="button" className="comment-avatar-preview" aria-label="头像加载失败，点击重试" title="头像加载失败，点击重试" onClick={() => { setImage(''); setStatus('loading'); setAttempt((value) => value + 1) }}><RotateCw size={18} /></button>
  return <span className="comment-avatar-preview" aria-busy={status === 'loading'}>
    {status === 'loading' && <span role="status" aria-label="正在加载头像"><LoaderCircle className="comment-avatar-preview__loading" size={18} /></span>}
    {image && <img src={image} alt="QQ 头像预览" width={32} height={32} hidden={status !== 'ready'} onLoad={() => setStatus('ready')} onError={() => setStatus('error')} />}
  </span>
}
