import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, List } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { getBlogArticleGuide, type BlogArticleGuide } from '../../lib/api'
import { motionTiming } from '../../lib/motion'
import './ArticleGuide.css'

type GuideState = { status: 'idle' | 'loading' | 'error' } | { status: 'loaded'; data: BlogArticleGuide }

export function ArticleGuide({ slug, revision }: { slug: string; revision?: string }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<GuideState>({ status: 'idle' })
  const [retry, setRetry] = useState(0)
  const loaded = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const panelId = useId()
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    const content = contentRef.current
    if (!open || !content) return
    // 内容加载和窄屏换行都可能改变高度，保持正文平滑移动。
    const observer = new ResizeObserver(() => setHeight(content.getBoundingClientRect().height))
    observer.observe(content)
    return () => observer.disconnect()
  }, [open])

  useEffect(() => {
    if (!open || loaded.current) return
    const controller = new AbortController()
    const deadline = window.setTimeout(() => {
      controller.abort()
      setState({ status: 'error' })
    }, 12000)
    const timer = window.setTimeout(() => {
      setState({ status: 'loading' })
      void getBlogArticleGuide(slug, revision, controller.signal).then((data) => {
        if (controller.signal.aborted) return
        loaded.current = true
        setState({ status: 'loaded', data })
      }).catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }) })
        .finally(() => window.clearTimeout(deadline))
    }, 0)
    return () => { window.clearTimeout(timer); window.clearTimeout(deadline); controller.abort() }
  }, [open, slug, revision, retry])

  function reload() {
    loaded.current = false
    setRetry((value) => value + 1)
  }

  const data = state.status === 'loaded' ? state.data : null
  return <section className="article-guide" aria-label="AI 导读">
    <button className="article-guide__trigger" type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
      <List size={16} aria-hidden="true" /><span>AI 导读</span>
      <span className="article-guide__action">{open ? '收起' : '展开要点'}<ChevronDown size={14} aria-hidden="true" /></span>
    </button>
    <div id={panelId} aria-hidden={!open} inert={!open}>
      <AnimatePresence initial={false}>
        {open && <motion.div className="article-guide__panel" key="guide" initial={{ height: 0, opacity: 0 }} animate={{ height, opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reducedMotion ? 0 : motionTiming.page, ease: motionTiming.ease }}>
          <div ref={contentRef} className="article-guide__content" aria-busy={state.status === 'loading'}>
            {(state.status === 'idle' || state.status === 'loading') && <p role="status">正在读取导读…</p>}
            {state.status === 'error' && <div role="alert"><p>导读暂时未能加载，文章仍可正常阅读。</p><button type="button" onClick={reload}>重新加载导读</button></div>}
            {data?.status === 'pending' && <div><p role="status">导读正在准备，稍后可以重新查看。</p><button type="button" onClick={reload}>重新查看导读</button></div>}
            {data?.status === 'unavailable' && <p>这篇文章暂时没有导读，可以直接阅读正文。</p>}
            {data?.status === 'outdated' && <p>文章已更新，刷新页面后可查看对应版本的导读。</p>}
            {data?.status === 'ready' && <>
              <ul aria-label="文章关键要点">{data.key_points.map((point, index) => <li key={index}>{point}</li>)}</ul>
              <p className="article-guide__focus"><span>阅读重点</span>{data.reading_focus}</p>
              <p className="article-guide__note">根据本文生成，供阅读参考。</p>
            </>}
          </div>
        </motion.div>}
      </AnimatePresence>
    </div>
  </section>
}
