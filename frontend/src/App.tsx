import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { Account } from './Account'
import { Studio } from './Studio'
import { StudioPortal } from './studio/StudioPortal'
import { Home } from './pages/home/Home'
import { PublicBlog } from './pages/blog/BlogPage'
import { MediaPage } from './pages/media/MediaPage'
import { ToolsPage } from './pages/tools/ToolsPage'

function LegacyStudioRedirect() {
  const location = useLocation()
  const isStudioRoot = /^\/blog\/studio\/?$/.test(location.pathname)
  const pathname = isStudioRoot
    ? '/studio'
    : location.pathname.replace(/^\/blog\/studio/, '/studio/blog')

  return <Navigate replace to={`${pathname}${location.search}${location.hash}`} />
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/blog/*" element={<PublicBlog />} />
        <Route path="/articles/:slug" element={<PublicBlog />} />
        <Route path="/tools/*" element={<ToolsPage />} />
        <Route path="/media/*" element={<MediaPage />} />
        <Route path="/media/projects/:projectId" element={<MediaPage />} />
        <Route path="/media/projects/:projectId/*" element={<MediaPage />} />
        <Route path="/blog/studio/*" element={<LegacyStudioRedirect />} />
        <Route path="/studio/blog/*" element={<Studio />} />
        <Route path="/studio" element={<StudioPortal />} />
        <Route path="/account" element={<Account />} />
      </Routes>
    </BrowserRouter>
  )
}
