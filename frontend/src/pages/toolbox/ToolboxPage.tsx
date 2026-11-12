import { ArrowUpRight, Braces, CodeXml, FileText, Globe, Search, X } from 'lucide-react'
import { useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ToolboxLayout } from './ToolboxLayout'
import './ToolboxPage.css'

const utilities = [
  { name: '文本工作台', description: '整理、转换和清洗日常文本。', icon: FileText },
  { name: '开发工具箱', description: '集中放置常用的开发辅助能力。', icon: Braces },
  { name: '网页收藏夹', description: '保存值得长期使用的站点与资源。', icon: Globe },
]

export function ToolboxPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const search = useRef<HTMLInputElement>(null)
  const matches = '免费 SVG 生成器 矢量图 图标 插画 MiMo'.toLowerCase().includes(query.trim().toLowerCase())
  function changeQuery(value: string) {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      if (value) next.set('q', value); else next.delete('q')
      return next
    }, { replace: true })
  }
  function clear() { changeQuery(''); search.current?.focus() }

  return <ToolboxLayout>
    <section className="toolbox-intro"><div><h1>工具箱</h1><p>把日常的小事，交给顺手的工具。</p></div><span>1 个工具可用</span></section>
    <section aria-labelledby="toolbox-directory-title">
      <div className="toolbox-section-heading"><h2 id="toolbox-directory-title">可用工具</h2><div className="toolbox-search"><Search aria-hidden="true" /><input ref={search} aria-label="搜索工具" placeholder="搜索工具" value={query} onChange={event => changeQuery(event.target.value)} />{query && <button aria-label="清空搜索" onClick={clear}><X /></button>}</div></div>
      {matches ? <Link className="toolbox-feature" to="/toolbox/svg">
        <div className="toolbox-feature-art" aria-hidden="true"><svg viewBox="0 0 400 240" fill="none"><path d="M70 170C70 30 330 210 330 70" stroke="currentColor" strokeWidth="3" /><path d="M70 170V70H330" stroke="currentColor" strokeOpacity=".25" strokeDasharray="4 6" /><circle cx="70" cy="70" r="6" fill="currentColor" /><circle cx="330" cy="170" r="6" fill="currentColor" /><path d="M330 70V170H70" stroke="currentColor" strokeOpacity=".25" strokeDasharray="4 6" /><rect x="63" y="163" width="14" height="14" rx="3" fill="currentColor" /><rect x="323" y="63" width="14" height="14" rx="3" fill="currentColor" /></svg><span>从一句描述，到一幅矢量图</span></div>
        <div className="toolbox-feature-copy"><span className="toolbox-tool-kind"><CodeXml />图形创作 · MiMo 免费</span><h3>SVG 生成器</h3><p>描述你想要的图标、插画或小图表。<br />预览生成结果，复制源码，或下载继续创作。</p><span className="toolbox-feature-action">打开生成器<ArrowUpRight /></span><small>登录后使用 · 不消耗钱包余额</small></div>
      </Link> : <div className="toolbox-empty" role="status"><Search aria-hidden="true" /><h3>没有找到匹配的工具</h3><p>试试“SVG”或“图标”，也可以清空搜索查看全部工具。</p><button onClick={clear}>清空搜索</button></div>}
    </section>
    {!query.trim() && <section className="toolbox-planned" aria-labelledby="toolbox-planned-title"><div className="toolbox-section-heading"><h2 id="toolbox-planned-title">接下来</h2><span>规划中，暂未开放</span></div><div className="toolbox-planned-grid">{utilities.map(({ name, description, icon: Icon }) => <article key={name}><Icon aria-hidden="true" /><h3>{name}</h3><p>{description}</p><span>规划中</span></article>)}</div></section>}
  </ToolboxLayout>
}
