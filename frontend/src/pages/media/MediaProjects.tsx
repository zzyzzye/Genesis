import { useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { MediaSurface } from './MediaMotion'
import { Link, useSearchParams } from 'react-router-dom'
import { FolderOpen, Image, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { Project } from './api'
import { ProjectCover, ProjectCoverDialog } from './ProjectPreview'
import { ProjectDialog, type ProjectAction } from './ProjectDialog'
import { MediaPageHeading } from './MediaPageHeading'
import type { CreateMediaProject } from './MediaLayout'
import type { MediaProjectCollection } from './useMediaProjects'
import { StudioActionMenu } from '../../studio/StudioActionMenu'

export function MediaProjects({ onCreate, collection }: { onCreate: CreateMediaProject; collection: MediaProjectCollection }) {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const { items: projects, loading, error, reload } = collection
  const [action, setAction] = useState<ProjectAction | null>(null)
  const [coverProject, setCoverProject] = useState<Project | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [visibleCount, setVisibleCount] = useState(24)

  const clearSearch = () => { const next = new URLSearchParams(params); next.delete('q'); setParams(next, { replace: true }); setVisibleCount(24); searchRef.current?.focus() }
  const filtered = projects.filter(project => project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const visible = filtered.slice(0, visibleCount)

  return <>
    <MediaPageHeading title="作品" description="管理作品封面与素材，继续你的创作。" meta={!loading && !error ? query ? `找到 ${filtered.length} 个作品` : `${projects.length} 个作品` : undefined} />
    <section className="media-home-projects" aria-label="作品列表">
      <div className="media-home-section-heading"><span className="media-project-sort">按最近编辑排序</span><div>
        <div className="media-home-search"><Search aria-hidden="true" /><input ref={searchRef} aria-label="搜索作品" placeholder="搜索作品" value={query} onChange={event => { const next = new URLSearchParams(params); if (event.target.value) next.set('q', event.target.value); else next.delete('q'); setParams(next, { replace: true }); setVisibleCount(24) }} />{query && <button aria-label="清空搜索" onClick={clearSearch}><X /></button>}</div>
      </div></div>
      <MediaSurface key={loading ? 'loading' : error ? 'error' : visible.length ? 'content' : 'empty'} fadeOnly>
      {loading ? <div className="media-home-list-state" role="status">正在加载作品…</div> : error ? <div className="media-home-list-state" role="alert"><p>{error}</p><button onClick={reload}>重新加载</button></div> : visible.length === 0 ? <div className="media-home-list-state"><FolderOpen /><div><h3>{query ? '没有找到匹配的作品' : '还没有作品'}</h3><p>{query ? '换个关键词，或清空搜索查看全部作品。' : '创建一个作品，开始整理画面、声音与灵感。'}</p></div><button onClick={() => query ? clearSearch() : onCreate()}>{query ? '清空搜索' : '创建第一个作品'}{query ? <X /> : <Plus />}</button></div> : <div className="media-home-project-grid">{visible.map(project => <article className="media-home-project" key={project.id}>
        <Link to={`/media/projects/${project.id}`} aria-label={`打开作品：${project.name}`}><ProjectCover project={project} /><span className="media-home-project-copy"><strong>{project.name}</strong><span>最近编辑 <time dateTime={project.updated_at}>{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(project.updated_at)).replaceAll('/', '-')}</time></span></span></Link>
        <button className="media-home-set-cover" aria-label={`设置封面：${project.name}`} onClick={() => setCoverProject(project)}><Image />设置封面</button>
        <div className="media-home-project-menu"><StudioActionMenu animated label={`管理作品：${project.name}`}>{close => <>
          <button role="menuitem" onClick={() => { close(); setAction({ kind: 'rename', project }) }}><Pencil />重命名</button>
          <button role="menuitem" data-destructive onClick={() => { close(); setAction({ kind: 'delete', project }) }}><Trash2 />删除作品</button>
        </>}</StudioActionMenu></div>
      </article>)}</div>}
      </MediaSurface>
      {!loading && !error && visible.length < filtered.length && <div className="media-projects-more"><span>已显示 {visible.length} / {filtered.length} 个作品</span><button onClick={() => setVisibleCount(value => value + 24)}>显示更多作品</button></div>}
    </section>
    <AnimatePresence>{action && <ProjectDialog key={action.kind} action={action} onClose={() => setAction(null)} onSaved={() => { setAction(null); reload() }} />}</AnimatePresence>
    <AnimatePresence>{coverProject && <ProjectCoverDialog key={coverProject.id} project={coverProject} onClose={() => setCoverProject(null)} onSaved={updated => { collection.update(updated); setCoverProject(null) }} />}</AnimatePresence>
  </>
}
