import './MediaPage.css'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { developmentLogin, getCurrentUser, type CurrentUser } from '../../lib/api'
import { clearStoredAuthToken, getStoredAuthToken, storeAuthToken } from '../../lib/auth'
import { api, type Project } from './api'
import { ProjectCanvas } from './ProjectCanvas'
import { AccountAssetsPage, ProjectAssetsPage, ProjectOverviewPage } from './ProjectWorkspace'

export function MediaPage() {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [checking, setChecking] = useState(() => Boolean(getStoredAuthToken()) || import.meta.env.DEV)
  const [authError, setAuthError] = useState('')
  const { projectId } = useParams()
  const location = useLocation()
  useEffect(() => {
    let active = true
    async function authenticate() {
      let token = getStoredAuthToken()
      try {
        if (!token && import.meta.env.DEV) {
          const login = await developmentLogin()
          if (!active) return
          token = login.access_token
          storeAuthToken(token)
        }
        if (!token) return
        try {
          const current = await getCurrentUser(token)
          if (active) setUser(current)
        } catch {
          clearStoredAuthToken()
          if (!import.meta.env.DEV) throw new Error('登录状态已过期，请重新登录。')
          const login = await developmentLogin()
          if (!active) return
          token = login.access_token
          storeAuthToken(token)
          const current = await getCurrentUser(token)
          if (active) setUser(current)
        }
      } catch (reason) {
        if (active) {
          setUser(null)
          setAuthError((reason as Error).message || '开发环境自动登录失败，请检查后端服务。')
        }
      } finally {
        if (active) setChecking(false)
      }
    }
    void authenticate()
    return () => { active = false }
  }, [])
  if (checking) return <main className="media-gate" role="status">正在打开创作空间…</main>
  if (!user) return <main className="media-gate"><Link to="/">← Genesis</Link><small>YOUR CREATIVE SPACE</small><h1>从一个作品开始。</h1><p>登录后管理你的作品、私有素材与创作画布。</p>{authError && <p role="alert">{authError}</p>}<Link className="media-accent" to={`/account?returnTo=${encodeURIComponent(location.pathname)}`}>登录并继续</Link></main>
  if (!projectId) return location.pathname.endsWith('/assets') ? <AccountAssetsPage /> : <ProjectList />
  if (location.pathname.endsWith('/canvas')) return <ProjectCanvas key={`${user.id}:${projectId}`} projectId={projectId} userId={user.id} />
  if (location.pathname.endsWith('/assets')) return <ProjectAssetsPage projectId={projectId} />
  return <ProjectOverviewPage projectId={projectId} />
}

function ProjectList() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    void api<Project[]>('/projects').then((result) => { if (active) setProjects(result) }).catch((reason: Error) => { if (active) setError(reason.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh])
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action() } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) } }
  const visible = projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase()))
  return <main className="media-projects">
    <Link className="media-back" to="/">← Genesis</Link>
    <section className="media-project-intro"><small>MAKE SOMETHING WORTH SEEING</small><h1>你的下一部作品，<br /><em>从这里开始。</em></h1><p>收集素材，铺开想法，让画面慢慢成形。</p><div><button className="media-accent" onClick={() => setCreating(true)}>＋ 创建作品</button><button onClick={() => void navigate('/media/assets')}>账户素材库 ↗</button></div></section>
    <div className="media-project-heading"><h2>我的作品 <small>{projects.length}</small></h2><input aria-label="搜索作品" placeholder="搜索作品" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    {error && <p role="alert" className="media-error">{error} <button onClick={() => setRefresh(refresh + 1)}>重试</button></p>}
    {loading ? <p role="status">正在加载作品…</p> : visible.length === 0 ? <div className="media-project-empty"><span>＋</span><h3>{query ? '没有找到匹配的作品' : '还没有作品'}</h3><p>为一个想法取个名字，打开属于它的画布。</p><button onClick={() => setCreating(true)}>创建第一个作品</button></div> : <div className="media-project-grid">{visible.map((project, index) => <article key={project.id}>
      <Link to={`/media/projects/${project.id}`} className="media-project-card"><div><span>{String(index + 1).padStart(2, '0')}</span><i aria-hidden="true">↗</i></div><h3>{project.name}</h3><small>更新于 {new Date(project.updated_at).toLocaleString('zh-CN')}</small></Link>
      <div className="media-project-actions"><button disabled={busy} onClick={() => { const next = window.prompt('作品名称', project.name); if (next?.trim()) void run(async () => { await api(`/projects/${project.id}`, 'PATCH', { name: next }); setRefresh(refresh + 1) }) }}>重命名</button><button disabled={busy} onClick={() => { if (window.confirm(`删除作品“${project.name}”及其专属素材？账户库中的素材会保留。`)) void run(async () => { await api(`/projects/${project.id}`, 'DELETE'); setRefresh(refresh + 1) }) }}>删除</button></div>
    </article>)}</div>}
    {creating && <div className="media-modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="new-project-title" className="media-new-project" onKeyDown={(event) => { if (event.key === 'Escape') setCreating(false) }}><form onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await api<Project>('/projects', 'POST', { name }); void navigate(`/media/projects/${result.id}`) }) }}><small>NEW PROJECT</small><h2 id="new-project-title">给作品一个名字</h2><label>作品名称<input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：雨后的城市" /></label><div><button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</button><button className="media-accent" disabled={busy || !name.trim()}>创建作品</button></div>{error && <p role="alert">{error}</p>}</form></section></div>}
  </main>
}
