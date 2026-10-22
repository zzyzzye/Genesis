import { useEffect, useState } from 'react'
import { createBrowserRouter, Navigate, Route, RouterProvider, Routes, useLocation, type Location } from 'react-router-dom'
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'motion/react'

import { Account } from './Account'
import { Studio } from './Studio'
import { Home } from './pages/home/Home'
import { PublicBlog } from './pages/blog/BlogPage'
import { PublicPages } from './pages/blog/PublicPages'
import { MediaPage } from './pages/media/MediaPage'
import { ToolboxPage } from './pages/toolbox/ToolboxPage'
import { motionCssVariables, pageTransition } from './lib/motion'
import { SessionRecovery } from './SessionRecovery'
import { CursorEffects } from './features/cursor/CursorEffects'
import { CursorTrail } from './features/cursor/CursorTrail'
import { FpsMonitor } from './features/performance/FpsMonitor'

function LegacyStudioRedirect() {
  const location = useLocation()
  const pathname = location.pathname.replace(/^\/studio(?:\/blog)?/, '/blog/studio')

  return <Navigate replace to={`${pathname}${location.search}${location.hash}`} />
}

function LegacyToolboxRedirect() {
  const location = useLocation()
  const pathname = location.pathname.replace(/^\/tools(?=\/|$)/, '/toolbox')

  return <Navigate replace to={`${pathname}${location.search}${location.hash}`} />
}

function getRouteMotionKey(pathname: string) {
  if (pathname.startsWith('/media')) return 'media'
  if (pathname.startsWith('/studio') || pathname.startsWith('/blog/studio')) return 'studio'
  if (pathname.startsWith('/blog') || pathname.startsWith('/articles')) return 'blog'
  if (pathname.startsWith('/toolbox')) return 'toolbox'
  if (pathname.startsWith('/account')) return 'account'
  return 'home'
}

export function AppRoutes() {
  return <SessionRecovery>{(location) => <PageRoutes location={location} />}</SessionRecovery>
}

function PageRoutes({ location }: { location: Location }) {
  const reducedMotion = useReducedMotion()

  return <AnimatePresence initial={false} mode="wait">
    <motion.div
      key={getRouteMotionKey(location.pathname)}
      className="app-route-transition"
      style={motionCssVariables}
      initial={reducedMotion ? false : 'initial'}
      animate="enter"
      exit={reducedMotion ? undefined : 'exit'}
      variants={pageTransition}
    >
      <Routes location={location}>
        <Route path="/" element={<Home />} />
        <Route path="/blog/*" element={<PublicBlog />} />
        <Route path="/blog/pages" element={<PublicPages />} />
        <Route path="/blog/pages/:slug" element={<PublicPages />} />
        <Route path="/articles/:slug" element={<PublicBlog />} />
        <Route path="/toolbox/*" element={<ToolboxPage />} />
        <Route path="/tools/*" element={<LegacyToolboxRedirect />} />
        <Route path="/media/*" element={<MediaPage />} />
        <Route path="/media/projects/:projectId" element={<MediaPage />} />
        <Route path="/media/projects/:projectId/*" element={<MediaPage />} />
        <Route path="/blog/studio/*" element={<Studio />} />
        <Route path="/studio/blog/*" element={<LegacyStudioRedirect />} />
        <Route path="/studio" element={<LegacyStudioRedirect />} />
        <Route path="/account" element={<Account />} />
      </Routes>
    </motion.div>
  </AnimatePresence>
}

export function App({ router: providedRouter }: { router?: ReturnType<typeof createBrowserRouter> }) {
  const [router] = useState(() => providedRouter ?? createBrowserRouter([{ path: '*', element: <AppRoutes /> }]))
  useEffect(() => () => { if (!providedRouter) router.dispose() }, [providedRouter, router])
  return (
    <MotionConfig reducedMotion="user">
      <CursorEffects />
      <CursorTrail />
      <FpsMonitor><RouterProvider router={router} /></FpsMonitor>
    </MotionConfig>
  )
}
