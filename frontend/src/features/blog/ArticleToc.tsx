import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, List } from 'lucide-react'
import { Link, useLocation, type Location } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { motionTiming } from '../../lib/motion'
import { ArticleMarkdown } from './ArticleMarkdown'
import { getArticleHeadings, getArticleTitleHeading, type ArticleHeading } from './articleOutline'
import './ArticleToc.css'

export function ArticleToc({ items, activeId, onNavigate, label = '文章目录', title = '目录', linkState, progressive = false }: {
  items: ArticleHeading[]
  activeId?: string
  onNavigate?: (item: ArticleHeading, index: number) => void
  label?: string
  title?: string
  linkState?: unknown
  progressive?: boolean
}) {
  const [expanded, setExpanded] = useState(() => !window.matchMedia?.('(max-width: 1100px)').matches)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const reducedMotion = useReducedMotion()
  const id = useId()
  const minLevel = items.length ? Math.min(...items.map(item => item.level)) : 1
  const sections: { heading: ArticleHeading; index: number; children: { heading: ArticleHeading; index: number }[] }[] = []
  items.forEach((heading, index) => {
    const section = sections.at(-1)
    if (!section || heading.level === minLevel) sections.push({ heading, index, children: [] })
    else section.children.push({ heading, index })
  })
  function headingLink(item: ArticleHeading, index: number) {
    return onNavigate ? <button type="button" aria-current={activeId === item.id ? 'location' : undefined} onClick={() => onNavigate(item, index)}>{item.text}</button>
      : <Link to={`#${item.id}`} state={linkState} preventScrollReset aria-current={activeId === item.id ? 'location' : undefined} onClick={event => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) requestAnimationFrame(() => document.getElementById(item.id)?.scrollIntoView({ block: 'start' }))
      }}>{item.text}</Link>
  }
  return <aside className="article-toc" aria-label={label}>
    <button className="article-toc__toggle" type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      <span><List size={15} aria-hidden="true" />{title} <small>{items.length}</small></span><ChevronDown size={14} aria-hidden="true" className={expanded ? 'is-expanded' : undefined} />
    </button>
    <motion.div
      id={id}
      className="article-toc__content"
      inert={!expanded}
      aria-hidden={!expanded}
      initial={false}
      animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
      transition={{ duration: reducedMotion ? 0 : motionTiming.panel, ease: motionTiming.ease }}
    >
      {items.length ? <nav aria-label={`${label}导航`}><ol>{progressive ? sections.map(section => {
        const active = section.heading.id === activeId || section.children.some(child => child.heading.id === activeId)
        const open = openSections[section.heading.id] ?? active
        const sectionId = `${id}-${section.heading.id}`
        return <li key={section.heading.id} className={`article-toc__section${active ? ' is-active' : ''}`}>
          <div className="article-toc__section-heading">
            {headingLink(section.heading, section.index)}
            {section.children.length > 0 && <button type="button" className="article-toc__section-toggle" aria-label={`${open ? '收起' : '展开'}“${section.heading.text}”子目录`} aria-expanded={open} aria-controls={sectionId} onClick={() => setOpenSections(value => ({ ...value, [section.heading.id]: !open }))}><ChevronDown size={13} aria-hidden="true" /></button>}
          </div>
          {section.children.length > 0 && <ol id={sectionId} hidden={!open} className="article-toc__children">{section.children.map(({ heading, index }) => <li key={heading.id} style={{ '--toc-indent': `${Math.min(heading.level - minLevel, 3) * 12}px` } as CSSProperties}>{headingLink(heading, index)}</li>)}</ol>}
        </li>
      }) : items.map((item, index) => <li key={item.id} style={{ '--toc-indent': `${Math.min(item.level - minLevel, 3) * 12}px` } as CSSProperties}>{headingLink(item, index)}</li>)}</ol></nav> : <p className="article-toc__empty">暂无章节标题</p>}
    </motion.div>
  </aside>
}

export function ArticleDocument({ content, title, className = '', label = '文章目录', tocTitle, intro, sidebar, children, progressiveToc = false }: {
  content: string
  title?: string
  className?: string
  label?: string
  tocTitle?: string
  intro?: ReactNode
  sidebar?: ReactNode
  children?: ReactNode
  progressiveToc?: boolean
}) {
  const location: Location<unknown> = useLocation()
  const titleHeading = useMemo(() => title ? getArticleTitleHeading(content, title) : undefined, [content, title])
  const items = useMemo(() => getArticleHeadings(content).filter(item => item.id !== titleHeading?.id), [content, titleHeading])
  const body = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState('')
  useEffect(() => {
    let frame = 0
    let anchorFrame = 0
    function update() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const headings = body.current?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
        let active = headings?.[0]?.id ?? ''
        headings?.forEach(heading => { if (heading.getBoundingClientRect().top <= 140) active = heading.id })
        setActiveId(active)
      })
    }
    update()
    // 异步加载正文后恢复章节深链接；评论锚点仍由评论区处理。
    try {
      const hash = decodeURIComponent(window.location.hash.slice(1))
      if (hash === titleHeading?.id || items.some(item => item.id === hash)) anchorFrame = requestAnimationFrame(() => {
        const heading = [...body.current?.querySelectorAll<HTMLElement>('[id]') ?? []].find(item => item.id === hash)
        heading?.scrollIntoView({ block: 'start' })
      })
    } catch { /* 无效的地址片段不影响正文阅读。 */ }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(anchorFrame); window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update) }
  }, [content, items, titleHeading])
  return <div className={`article-document ${className}`}>
    {intro}
    <div className="article-document__toc">{sidebar}<ArticleToc key={title ?? ''} items={items} activeId={activeId} label={label} title={tocTitle} linkState={location.state} progressive={progressiveToc} /></div>
    <div className="article-content" ref={body}><ArticleMarkdown titleHeadingId={titleHeading?.id}>{content}</ArticleMarkdown></div>
    {children}
  </div>
}
