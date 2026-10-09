import './MediaHome.css'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, AudioLines, BookOpen, Check, ChevronRight, Clapperboard, Film, FolderOpen, House, Image, Layers3, LayoutGrid, Menu, MoreHorizontal, Pencil, Plus, Search, Sparkles, StickyNote, Trash2, UserRound, WandSparkles, X } from 'lucide-react'
import { api, type Project } from './api'
import { PanelsTopLeft, LibraryBig } from 'lucide-react'

type ProjectAction = { kind: 'create' | 'rename' | 'delete'; project?: Project; canvas?: boolean; title?: string }

export function MediaHome() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const allProjects = params.get('view') === 'projects'
  const query = params.get('q') ?? ''
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [action, setAction] = useState<ProjectAction | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    void api<Project[]>('/projects').then((result) => {
      if (active) { setProjects([...result].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))); setError('') }
    }).catch((reason: Error) => { if (active) setError(reason.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh])
  useEffect(() => {
    if (!openMenu) return
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element).closest('.media-home-project-menu')) setOpenMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenMenu(null) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [openMenu])
  useEffect(() => {
    if (!mobileNav) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileNav(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [mobileNav])
  const create = (title = '', canvas = true) => { setMobileNav(false); setAction({ kind: 'create', title, canvas }) }
  const changeView = (all: boolean) => { setParams(all ? { view: 'projects' } : {}); setMobileNav(false) }
  const filtered = projects.filter((project) => project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const visible = allProjects || query ? filtered : filtered.slice(0, 4)
  const shortcuts = [
    { label: '视频画布', icon: Clapperboard, title: '视频创作' },
    { label: '图片画布', icon: Image, title: '视觉创作' },
    { label: '声音编排', icon: AudioLines, title: '声音设计' },
    { label: '分镜编排', icon: Film, title: '分镜创作' },
    { label: '创意便签', icon: StickyNote, title: '灵感记录' },
    { label: '自由画布', icon: WandSparkles, title: '' },
  ]
  return <div className="media-home">
    <aside className={`media-home-sidebar${mobileNav ? ' is-open' : ''}`} aria-label="影音导航">
      <Link className="media-home-brand" to="/"><span aria-hidden="true"><Layers3 /></span>Genesis<span className="media-home-brand-label">STUDIO</span></Link>
      <button className="media-home-primary" onClick={() => create('', false)}><Plus />新建项目</button>
      <nav aria-label="创作空间">
        <button onClick={() => { setMobileNav(false); window.dispatchEvent(new Event('genesis:open-media-assistant')) }}><Sparkles />镜头搭档<span className="media-home-tag">AI</span></button>
        <button aria-current={!allProjects ? 'page' : undefined} onClick={() => changeView(false)}><House />首页</button>
        <button aria-current={allProjects ? 'page' : undefined} onClick={() => changeView(true)}><PanelsTopLeft />项目</button>
        <Link to="/media/assets"><LibraryBig />素材库</Link>
        <Link to="/toolbox"><LayoutGrid />工具箱<ChevronRight className="media-home-nav-arrow" /></Link>
        <span className="media-home-nav-label">探索</span>
        <Link to="/blog"><BookOpen />创作阅读</Link>
      </nav>
      <div className="media-home-sidebar-bottom"><Link to="/"><ArrowLeft />返回 Genesis</Link></div>
    </aside>
    {mobileNav && <button className="media-home-nav-scrim" aria-label="收起导航" onClick={() => setMobileNav(false)} />}
    <main className="media-home-main">
      <header className="media-home-topbar"><button className="media-home-mobile-toggle" aria-label={mobileNav ? '收起导航' : '展开导航'} aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}><Menu /></button><span>创作空间</span><div><Link to="/media/assets"><Layers3 />账户素材库</Link><Link className="media-home-account" to="/account" aria-label="账户设置"><UserRound /></Link></div></header>
      {!allProjects && <>
        <div className="media-home-launch">
          <button className="media-home-hero" onClick={() => create()}><h1>新建画布创作</h1><span className="media-home-hero-hint">编排视频、图片、音频和便签</span><span className="media-home-hero-action">新建画布<Plus /></span></button>
          <button className="media-home-companion" onClick={() => window.dispatchEvent(new Event('genesis:open-media-assistant'))}><Sparkles /><strong>镜头搭档</strong><span>讨论剧本与分镜</span><span className="media-home-companion-action">打开助手<ArrowUpRight /></span></button>
        </div>
        <section className="media-home-shortcuts" aria-label="创作工具">
          {shortcuts.map(({ label, icon: Icon, title }) => <button key={label} onClick={() => create(title)}><span><Icon /></span>{label}</button>)}
          <Link to="/media/assets"><span><Layers3 /></span>素材管理</Link>
          <button onClick={() => window.dispatchEvent(new Event('genesis:open-media-assistant'))}><span><Sparkles /></span>AI 创作助手</button>
        </section>
      </>}
      <section className="media-home-projects" aria-labelledby="media-home-projects-heading">
        <div className="media-home-section-heading"><h2 id="media-home-projects-heading">{allProjects ? '全部项目' : '最近项目'}{allProjects && <small>{projects.length}</small>}</h2><div>
          <div className="media-home-search"><Search aria-hidden="true" /><input ref={searchRef} aria-label="搜索作品" placeholder="搜索项目" value={query} onChange={(event) => { const next = new URLSearchParams(params); if (event.target.value) next.set('q', event.target.value); else next.delete('q'); setParams(next, { replace: true }) }} />{query && <button aria-label="清空搜索" onClick={() => { const next = new URLSearchParams(params); next.delete('q'); setParams(next, { replace: true }); searchRef.current?.focus() }}><X /></button>}</div>
          {!allProjects && <button className="media-home-see-all" onClick={() => changeView(true)}>查看全部<ChevronRight /></button>}
          {allProjects && <button className="media-home-primary" onClick={() => create('', false)}><Plus />新建项目</button>}
        </div></div>
        {loading ? <div className="media-home-list-state" role="status">正在加载项目…</div> : error ? <div className="media-home-list-state" role="alert"><p>{error}</p><button onClick={() => { setLoading(true); setRefresh((value) => value + 1) }}>重新加载</button></div> : visible.length === 0 ? <div className="media-home-list-state"><FolderOpen /><div><h3>{query ? '没有找到匹配的项目' : '还没有项目，先开启一个新故事'}</h3><p>{query ? '换个关键词，或清空搜索查看全部项目。' : '视频、图片、声音与灵感，都可以从这里开始。'}</p></div><button onClick={() => query ? (setParams(allProjects ? { view: 'projects' } : {})) : create()}>{query ? '清空搜索' : '创建第一个作品'}{query ? <X /> : <Plus />}</button></div> : <div className="media-home-project-grid">{visible.map((project) => <article className="media-home-project" key={project.id}>
          <Link to={`/media/projects/${project.id}`}><span className="media-home-project-thumbnail"><Clapperboard /></span><span className="media-home-project-copy"><strong>{project.name}</strong><time dateTime={project.updated_at}>{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(project.updated_at)).replaceAll('/', '-')}</time></span></Link>
          <div className="media-home-project-menu"><button aria-label={`管理项目：${project.name}`} aria-expanded={openMenu === project.id} onClick={() => setOpenMenu(openMenu === project.id ? null : project.id)}><MoreHorizontal /></button>{openMenu === project.id && <div className="media-home-menu"><button onClick={() => { setAction({ kind: 'rename', project }); setOpenMenu(null) }}><Pencil />重命名</button><button onClick={() => { setAction({ kind: 'delete', project }); setOpenMenu(null) }}><Trash2 />删除项目</button></div>}</div>
        </article>)}</div>}
      </section>
    </main>
    {action && <ProjectDialog action={action} onClose={() => setAction(null)} onSaved={(project) => { setAction(null); if (action.kind === 'create' && project) void navigate(`/media/projects/${project.id}${action.canvas ? '/canvas' : ''}`); else setRefresh((value) => value + 1) }} />}
  </div>
}

export function ProjectDialog({ action, onClose, onSaved }: { action: ProjectAction; onClose: () => void; onSaved: (project?: Project) => void }) {
  const [name, setName] = useState(action.project?.name ?? action.title ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const deleting = action.kind === 'delete'
  useEffect(() => { const element = dialog.current; const previous = document.activeElement as HTMLElement; element?.showModal(); element?.querySelector<HTMLInputElement>('input')?.focus(); return () => { element?.close(); previous?.focus() } }, [])
  async function submit() {
    if (busy) return
    if (!deleting && !name.trim()) { setError('请输入作品名称。'); return }
    setBusy(true); setError('')
    try {
      const result = action.kind === 'create' ? await api<Project>('/projects', 'POST', { name: name.trim() }) : await api<Project>(`/projects/${action.project!.id}`, deleting ? 'DELETE' : 'PATCH', deleting ? undefined : { name: name.trim() })
      onSaved(result)
    } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="media-home-dialog" aria-labelledby="media-home-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <form noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}><header><h2 id="media-home-dialog-title">{deleting ? '删除项目' : action.kind === 'rename' ? '重命名项目' : '给作品一个名字'}</h2><button type="button" aria-label="关闭" disabled={busy} onClick={onClose}><X /></button></header>
      {deleting ? <p>删除“{action.project?.name}”及其专属素材？此操作无法撤销，账户素材库中的素材会保留。</p> : <label>作品名称<input autoFocus maxLength={120} value={name} aria-invalid={Boolean(error)} aria-describedby={error ? 'media-home-dialog-error' : undefined} onChange={(event) => setName(event.target.value)} placeholder="例如：雨后的城市" /></label>}
      <div className="media-home-dialog-feedback" aria-live="polite">{error && <p id="media-home-dialog-error" role="alert">{error}</p>}</div><footer><button type="button" autoFocus={deleting} disabled={busy} onClick={onClose}>取消</button><button className={deleting ? 'media-home-danger' : 'media-home-primary'} disabled={busy || (!deleting && !name.trim())} aria-busy={busy}>{busy ? '正在处理…' : deleting ? '删除项目' : action.kind === 'rename' ? '保存名称' : '创建作品'}{!busy && !deleting && <Check />}</button></footer>
    </form>
  </dialog>
}
