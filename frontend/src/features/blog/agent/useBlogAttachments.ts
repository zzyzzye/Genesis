import { useEffect, useRef, useState } from 'react'
import { uploadAttachment } from '../../../lib/attachments'
import { getStoredAuthToken, studioAuthTokenKey } from '../../../lib/auth'
import { conversationIsSelected, type AiAttachment, type AiConversationSelection } from '../../../lib/api'

export const agentAttachmentAccept = '.txt,.md,.markdown,.csv,.json,.log,.yaml,.yml,.pdf,.docx,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm'
const limit = 20 * 1024 * 1024
export type PendingAttachment = AiAttachment & { file: File; status: 'uploading' | 'ready' | 'failed'; progress: number; error?: string }

export function useBlogAttachments(conversationKey: string, authKey = studioAuthTokenKey) {
  const [queues, setQueues] = useState<Record<string, PendingAttachment[]>>({})
  const queuesRef = useRef(queues)
  const controllers = useRef(new Map<string, AbortController>())
  const mounted = useRef(true)
  const [error, setError] = useState('')
  function update(key: string, change: (items: PendingAttachment[]) => PendingAttachment[]) {
    if (!mounted.current) return
    queuesRef.current = { ...queuesRef.current, [key]: change(queuesRef.current[key] ?? []) }
    setQueues(queuesRef.current)
  }
  useEffect(() => {
    mounted.current = true
    const active = controllers.current
    return () => { mounted.current = false; active.forEach(controller => controller.abort()); active.clear() }
  }, [])

  async function upload(key: string, item: PendingAttachment) {
    if (controllers.current.has(item.id)) return
    const token = getStoredAuthToken(authKey)
    if (!token) { update(key, items => items.map(value => value.id === item.id ? { ...value, status: 'failed', error: '登录已失效，请重新登录。' } : value)); return }
    const controller = new AbortController()
    controllers.current.set(item.id, controller)
    update(key, items => items.map(value => value.id === item.id ? { ...value, status: 'uploading', progress: 0, error: undefined } : value))
    try {
      const saved = await uploadAttachment(token, item.id, item.file, null, `Agent 附件/${item.id}/${item.name}`, percent => update(key, items => items.map(value => value.id === item.id ? { ...value, progress: percent } : value)), controller.signal)
      update(key, items => items.map(value => value.id === item.id ? { ...value, name: saved.name, size: saved.size, status: 'ready', progress: 100 } : value))
    } catch (reason) {
      update(key, items => items.map(value => value.id === item.id ? { ...value, status: 'failed', error: controller.signal.aborted ? '已停止，可重试核对上传结果。' : reason instanceof Error ? reason.message : '上传失败，请重试。' } : value))
    } finally { controllers.current.delete(item.id) }
  }

  function add(files: File[]) {
    setError('')
    const current = queuesRef.current[conversationKey] ?? []
    if (current.length + files.length > 8) { setError('每次最多添加 8 个附件。'); return }
    if (files.reduce((sum, file) => sum + file.size, current.reduce((sum, file) => sum + file.size, 0)) > limit) { setError('附件总大小不能超过 20 MiB。'); return }
    const next: PendingAttachment[] = []
    for (const file of files) {
      const extension = '.' + file.name.split('.').at(-1)?.toLowerCase()
      if (!agentAttachmentAccept.split(',').includes(extension) || !file.size) { setError('请选择非空的文本文档、PDF、DOCX、常见图片或 MP4/WebM。'); return }
      const kind = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension) ? 'image' : ['.mp4', '.webm'].includes(extension) ? 'video' : 'document'
      next.push({ id: crypto.randomUUID(), name: file.name, size: file.size, mime_type: file.type, kind, file, status: 'uploading', progress: 0 })
    }
    update(conversationKey, items => [...items, ...next])
    next.forEach(item => { void upload(conversationKey, item) })
  }
  const items = queues[conversationKey] ?? []
  return {
    items, error, add,
    pending: items.some(item => item.status === 'uploading'),
    ready: items.length > 0 && items.every(item => item.status === 'ready'),
    retry: (item: PendingAttachment) => { void upload(conversationKey, item) },
    stop: (id: string) => controllers.current.get(id)?.abort(),
    remove: (id: string) => { controllers.current.get(id)?.abort(); update(conversationKey, items => items.filter(item => item.id !== id)); setError('') },
    moveTo: (key: string) => {
      if (key === conversationKey) return
      const current = queuesRef.current[conversationKey] ?? []
      update(key, () => current)
      update(conversationKey, () => [])
    },
    clear: (key: string) => update(key, () => []),
    drop: (selection: AiConversationSelection) => Object.keys(queuesRef.current).forEach(key => {
      if (key !== 'new' && conversationIsSelected(selection, key)) update(key, () => [])
    }),
  }
}
