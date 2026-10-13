import { Activity, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import { Account } from './Account'
import { studioSessionExpiredEvent } from './lib/auth'
import type { CurrentUser } from './lib/api'
import { useModalDialog } from './studio/useModalDialog'
import './studio/BlogWorkflowDialog.css'
import './SessionRecovery.css'

function ExpiredNotice({ onContinue }: { onContinue: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  const dialog = useModalDialog(button)
  useEffect(() => {
    const timer = window.setTimeout(onContinue, 2200)
    return () => window.clearTimeout(timer)
  }, [onContinue])
  return <dialog ref={dialog} className="blog-workflow-dialog session-recovery-dialog" aria-labelledby="session-recovery-title" aria-describedby="session-recovery-description" onCancel={(event) => { event.preventDefault(); onContinue() }}>
    <h2 id="session-recovery-title">登录已失效</h2>
    <p id="session-recovery-description">即将返回登录页，登录后继续当前操作。</p>
    <footer><button ref={button} className="blog-workflow-dialog__confirm" type="button" onClick={onContinue}>立即登录</button></footer>
  </dialog>
}

export function SessionRecovery({ children }: { children: (location: Location) => ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [recovery, setRecovery] = useState<{ source: Location; phase: 'notice' | 'login' | 'resuming'; userId?: string } | null>(null)
  const [generation, setGeneration] = useState(0)
  const redirected = useRef(false)
  const loginVisited = useRef(false)
  useLayoutEffect(() => {
    const expire = (event: Event) => {
      event.preventDefault()
      const userId = event instanceof CustomEvent ? (event.detail as { userId?: string }).userId : undefined
      setRecovery((current) => current ?? { source: location, phase: 'notice', userId })
    }
    window.addEventListener(studioSessionExpiredEvent, expire)
    return () => window.removeEventListener(studioSessionExpiredEvent, expire)
  }, [location])
  useEffect(() => {
    function followNavigation() {
      if (!recovery) return
      if (recovery.phase === 'resuming') {
        const source = recovery.source
        if (location.pathname === source.pathname && location.search === source.search && location.hash === source.hash) setRecovery(null)
      } else if (recovery.phase === 'login') {
        if (!redirected.current) {
          redirected.current = true
          const { pathname, search, hash } = recovery.source
          void navigate(`/account?reason=expired&returnTo=${encodeURIComponent(pathname + search + hash)}`, { replace: true })
        } else if (location.pathname === '/account') loginVisited.current = true
        else if (loginVisited.current) {
          redirected.current = false
          loginVisited.current = false
          setGeneration((value) => value + 1)
          setRecovery(null)
        }
      }
    }
    followNavigation()
  }, [recovery, location, navigate])

  function restore(user: CurrentUser) {
    if (!recovery) return
    if (recovery.userId && recovery.userId !== user.id) setGeneration((value) => value + 1)
    const { pathname, search, hash } = recovery.source
    redirected.current = false
    loginVisited.current = false
    setRecovery({ ...recovery, phase: 'resuming' })
    void navigate(pathname + search + hash, { replace: true })
  }

  // 隐藏原页面并暂停其副作用，保留输入；登录过程不把草稿和 QQ 资料另存到浏览器。
  return <>
    <Activity key={generation} mode={recovery?.phase === 'login' ? 'hidden' : 'visible'}>{children(recovery?.source ?? location)}</Activity>
    {recovery?.phase === 'notice' && <ExpiredNotice onContinue={() => setRecovery((current) => current ? { ...current, phase: 'login' } : null)} />}
    {recovery?.phase === 'login' && <Account onAuthenticated={restore} />}
  </>
}
