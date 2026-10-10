import { isValidElement, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import './ArticleMarkdown.css'

type Token = { from: number; to: number; classes: string }

// 长代码默认只显示前 20 行，展开和复制均保留完整内容。
const collapsedLineCount = 20

function CodeBlock({ source, language }: { source: string; language: string }) {
  const description = LanguageDescription.matchLanguageName(languages, language)
  const label = description?.name || language || '纯文本'
  const [highlight, setHighlight] = useState<{ source: string; language: string; tokens: Token[] }>()
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)
  const codeId = useId()

  useEffect(() => {
    let cancelled = false
    if (description) {
      void description.load().then((support) => {
        const tokens: Token[] = []
        highlightTree(support.language.parser.parse(source), classHighlighter, (from, to, classes) => {
          tokens.push({ from, to, classes })
        })
        if (!cancelled) setHighlight({ source, language, tokens })
      }).catch(() => {
        // 语言加载失败时保留完整纯文本，复制仍然可用。
      })
    }
    return () => { cancelled = true }
  }, [description, source, language])

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  async function copyCode() {
    setCopyState('copying')
    clearTimeout(resetTimer.current)
    try {
      await navigator.clipboard.writeText(source)
      setCopyState('copied')
      resetTimer.current = setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('error')
    }
  }

  const tokens = highlight?.source === source && highlight.language === language ? highlight.tokens : []
  // Markdown 追加的末尾换行不计入可见行数，复制保留原始内容。
  const lines = source.replace(/\n$/, '').split('\n')
  const collapsible = lines.length > collapsedLineCount
  const visibleLines = collapsible && !expanded ? lines.slice(0, collapsedLineCount) : lines
  let offset = 0
  const renderedLines: ReactNode[] = []
  for (const [index, line] of visibleLines.entries()) {
    const start = offset
    const end = start + line.length
    offset = end + 1
    const pieces: ReactNode[] = []
    let cursor = start
    for (const token of tokens) {
      if (token.to <= start) continue
      if (token.from >= end) break
      const from = Math.max(start, token.from)
      const to = Math.min(end, token.to)
      if (from > cursor) pieces.push(source.slice(cursor, from))
      pieces.push(<span key={`${from}-${to}`} className={token.classes}>{source.slice(from, to)}</span>)
      cursor = to
    }
    if (cursor < end) pieces.push(source.slice(cursor, end))
    renderedLines.push(<span className="article-code__line" key={index}><span className="article-code__number" aria-hidden="true">{index + 1}</span><span>{pieces}{index < visibleLines.length - 1 ? '\n' : ''}</span></span>)
  }

  return <div className="article-code" style={{ '--code-number-width': `${Math.max(4, String(lines.length).length)}ch` } as CSSProperties}>
    <div className="article-code__toolbar">
      <span className="article-code__language">{label}<span>{lines.length} 行</span></span>
      <button type="button" onClick={() => void copyCode()} disabled={copyState === 'copying'} aria-label={`复制 ${label} 代码`}>
        {copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
        <span aria-live="polite">{copyState === 'copied' ? '已复制' : copyState === 'error' ? '重试复制' : '复制'}</span>
      </button>
    </div>
    {copyState === 'error' && <div className="article-code__error" role="status">复制失败，请重试或手动选择代码。</div>}
    <pre id={codeId} tabIndex={0} aria-label={`${label} 代码`}><code>{renderedLines}</code></pre>
    {collapsible && <button className="article-code__toggle" type="button" aria-expanded={expanded} aria-controls={codeId} onClick={() => setExpanded((value) => !value)}>
      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      {expanded ? '收起代码' : `展开剩余 ${lines.length - collapsedLineCount} 行`}
    </button>}
  </div>
}

function CodePre({ children }: { children?: ReactNode }) {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) return <pre>{children}</pre>
  const language = /language-([^\s]+)/.exec(children.props.className || '')?.[1] || ''
  const source = typeof children.props.children === 'string' ? children.props.children : ''
  return <CodeBlock key={`${language}:${source}`} source={source} language={language} />
}

export function ArticleMarkdown({ children }: { children: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={{ pre: CodePre }}>{children}</Markdown>
}
