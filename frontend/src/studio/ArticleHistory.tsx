import { useEffect, useRef, useState } from 'react'
import type { BlogCategory, BlogTag } from '../lib/api'
import { getRevision, getRevisions, type RevisionDetail, type RevisionSummary } from '../lib/blogHistory'
import type { EditorState } from './blogEditor'
import { useModalDialog } from './useModalDialog'
import './ArticleHistory.css'

export function ArticleHistory({ token, editor, categories, tags, onApply, onClose }: {
  token: string; editor: EditorState; categories: BlogCategory[]; tags: BlogTag[]
  onApply: (editor: EditorState) => void; onClose: () => void
}) {
  const close = useRef<HTMLButtonElement>(null)
  const dialog = useModalDialog(close)
  const [items, setItems] = useState<RevisionSummary[]>([])
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState<RevisionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void getRevisions(token, editor.id!, offset, controller.signal).then(data => {
      if (!controller.signal.aborted) { setItems(data.items); setTotal(data.total) }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '历史版本读取失败。') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [token, editor.id, offset, retry])
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    void getRevision(token, editor.id!, selected, controller.signal).then(data => { if (!controller.signal.aborted) setDetail(data) })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '版本内容读取失败。') })
      .finally(() => { if (!controller.signal.aborted) setReading(false) })
    return () => controller.abort()
  }, [token, editor.id, selected, retry])
  function select(id: string) { setSelected(id); setDetail(null); setReading(true); setError(''); setConfirm(false) }
  function page(next: number) { setOffset(next); setLoading(true); setError(''); setSelected(''); setDetail(null); setConfirm(false) }
  function restore() {
    if (!detail) return
    const old = detail.payload
    const categoryIds = (old.category_ids ?? []).filter(id => categories.some(item => item.id === id))
    onApply({ ...editor, title: old.title, excerpt: old.excerpt, contentMarkdown: old.content_markdown,
      coverImageUrl: old.cover_image_url ?? '', isFeatured: old.is_featured, readTimeMinutes: old.read_time_minutes,
      categoryIds, categoryId: categoryIds[0] ?? null,
      selectedTagSlugs: old.tags.filter(tag => tags.some(item => item.slug === tag.slug)).map(tag => tag.slug),
    })
  }
  const comparisons = detail ? [
    ['标题', editor.title, detail.payload.title], ['摘要', editor.excerpt, detail.payload.excerpt],
    ['封面', editor.coverImageUrl, detail.payload.cover_image_url ?? ''],
    ['分类', (editor.categoryIds ?? []).map(id => categories.find(c => c.id === id)?.name ?? id).join('、'), (detail.payload.category_ids ?? []).map(id => categories.find(c => c.id === id)?.name ?? '已删除分类').join('、')],
    ['标签', editor.selectedTagSlugs.map(slug => tags.find(t => t.slug === slug)?.name ?? slug).join('、'), detail.payload.tags.map(t => t.name).join('、')],
    ['精选', editor.isFeatured ? '是' : '否', detail.payload.is_featured ? '是' : '否'],
    ['阅读时长', `${editor.readTimeMinutes} 分钟`, `${detail.payload.read_time_minutes} 分钟`],
    ['正文', editor.contentMarkdown, detail.payload.content_markdown],
  ] : []
  return <dialog ref={dialog} className="article-history" aria-labelledby="article-history-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <header><div><h2 id="article-history-title">文章历史</h2><p>比较历史与当前编辑内容，载入后仍需保存。</p></div><button ref={close} onClick={onClose}>关闭</button></header>
    <div className="article-history__layout">
      <aside aria-label="已保存版本">
        {loading ? <p role="status">正在读取历史…</p> : <>
          {!items.length && !error && <p>还没有历史版本。下次保存时会记录当前内容与新版本。</p>}
          {items.map(item => <button key={item.id} aria-pressed={selected === item.id} onClick={() => select(item.id)}><time>{new Date(item.version).toLocaleString('zh-CN')}</time><span>{item.title || '未命名文章'}</span></button>)}
          {total > 20 && <nav aria-label="历史分页"><button disabled={!offset} onClick={() => page(offset - 20)}>上一页</button><span>{offset / 20 + 1} / {Math.ceil(total / 20)}</span><button disabled={offset + 20 >= total} onClick={() => page(offset + 20)}>下一页</button></nav>}
        </>}
      </aside>
      <section aria-label="版本对比">
        {error && <p role="alert">{error}<button onClick={() => { setError(''); setLoading(true); if (selected) setReading(true); setRetry(n => n + 1) }}>重新加载</button></p>}
        {reading ? <p role="status">正在读取版本内容…</p> : !detail ? <p>选择一个已保存版本，与当前编辑内容对比。</p> : <>
          <div className="article-history__columns"><strong>当前编辑内容</strong><strong>历史版本</strong></div>
          {comparisons.map(([label, current, previous]) => <div key={label} className="article-history__field"><h3>{label}<span>{current === previous ? '相同' : '有改动'}</span></h3><div className="article-history__columns"><pre>{current || '（空）'}</pre><pre className={current !== previous ? 'article-history__changed' : ''}>{previous || '（空）'}</pre></div></div>)}
        </>}
      </section>
    </div>
    <footer>{confirm ? <><p>将替换当前未保存的内容；文章地址、发布状态与计划保持不变。已删除的分类和标签不恢复。</p><button onClick={() => setConfirm(false)}>取消载入</button><button className="article-history__apply" onClick={restore}>确认载入编辑器</button></> : <><p>历史不会被修改，载入不会立即更新线上文章。</p><button className="article-history__apply" disabled={!detail || reading || Boolean(error)} onClick={() => setConfirm(true)}>载入此版本</button></>}</footer>
  </dialog>
}
