import './MediaPage.css'
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { developmentLogin, getCurrentUser, type CurrentUser } from '../../lib/api'
import { clearStoredAuthToken, getStoredAuthToken, storeAuthToken } from '../../lib/auth'
import { MediaHome } from './MediaHome'
import { ProjectCanvas } from './ProjectCanvas'
import { AccountAssetsPage, ProjectAssetsPage, ProjectOverviewPage } from './ProjectWorkspace'
import { MediaAssistant, type MediaAssistantNode, type MediaCanvasPlan } from './MediaAssistant'

export function MediaPage() {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [checking, setChecking] = useState(() => Boolean(getStoredAuthToken()) || import.meta.env.DEV)
  const [authError, setAuthError] = useState('')
  const [agentNode, setAgentNode] = useState<MediaAssistantNode | null>(null)
  const [agentCanvasApply, setAgentCanvasApply] = useState<((plan: MediaCanvasPlan) => void) | null>(null)
  const handleAgentCanvasApplyChange = useCallback((apply: ((plan: MediaCanvasPlan) => void) | null) => setAgentCanvasApply(() => apply), [])
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
  const page = location.pathname.endsWith('/canvas') ? 'canvas' : location.pathname.endsWith('/assets') ? 'assets' : projectId ? 'project' : 'projects'
  const content = !projectId
    ? (page === 'assets' ? <AccountAssetsPage /> : <MediaHome />)
    : page === 'canvas'
      ? <ProjectCanvas key={`${user.id}:${projectId}`} projectId={projectId} userId={user.id} onAgentNodeChange={setAgentNode} onAgentCanvasApplyChange={handleAgentCanvasApplyChange} />
      : page === 'assets'
        ? <ProjectAssetsPage projectId={projectId} />
        : <ProjectOverviewPage projectId={projectId} />
  return <>{content}<MediaAssistant token={getStoredAuthToken()} page={page} projectId={projectId} selectedNode={page === 'canvas' ? agentNode : null} onApplyCanvasPlan={page === 'canvas' ? agentCanvasApply ?? undefined : undefined} /></>
}
