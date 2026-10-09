import { useEffect, useState } from 'react'
import { createBrowserRouter, Navigate, Route, RouterProvider, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'motion/react'

import { Account } from './Account'
import { Studio } from './Studio'
import { Home } from './pages/home/Home'
import { PublicBlog } from './pages/blog/BlogPage'
import { MediaPage } from './pages/media/MediaPage'
import { ToolsPage } from './pages/tools/ToolsPage'
import { pageTransition } from './lib/motion'

function LegacyStudioRedirect() {
  const location = useLocation()
  const pathname = location.pathname.replace(/^\/studio(?:\/blog)?/, '/blog/studio')

  return <Navigate replace to={`${pathname}${location.search}${location.hash}`} />
}

function getRouteMotionKey(pathname: string) {
  if (pathname.startsWith('/media')) return 'media'
  if (pathname.startsWith('/studio') || pathname.startsWith('/blog/studio')) return 'studio'
  if (pathname.startsWith('/blog') || pathname.startsWith('/articles')) return 'blog'
  if (pathname.startsWith('/tools')) return 'tools'
  if (pathname.startsWith('/account')) return 'account'
  return 'home'
}

export function AppRoutes() {
  const location = useLocation()
  const reducedMotion = useReducedMotion()

  return <AnimatePresence initial={false} mode="wait">
    <motion.div
      key={getRouteMotionKey(location.pathname)}
      className="app-route-transition"
      initial={reducedMotion ? false : 'initial'}
      animate="enter"
      exit={reducedMotion ? undefined : 'exit'}
      variants={pageTransition}
    >
      <Routes location={location}>
        <Route path="/" element={<Home />} />
        <Route path="/blog/*" element={<PublicBlog />} />
        <Route path="/articles/:slug" element={<PublicBlog />} />
        <Route path="/tools/*" element={<ToolsPage />} />
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
      <RouterProvider router={router} />
    </MotionConfig>
  )
}
