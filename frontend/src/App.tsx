import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { Account } from './Account'
import { Studio } from './Studio'
import { SystemLanding } from './SystemLanding'
import { Home } from './pages/home/Home'
import { PublicBlog } from './pages/blog/BlogPage'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/blog/*" element={<PublicBlog />} />
        <Route path="/articles/:slug" element={<PublicBlog />} />
        <Route path="/tools/*" element={<SystemLanding system="tools" />} />
        <Route path="/media/*" element={<SystemLanding system="media" />} />
        <Route path="/blog/studio/*" element={<Studio />} />
        <Route path="/studio" element={<Navigate to="/blog/studio" replace />} />
        <Route path="/account" element={<Account />} />
      </Routes>
    </BrowserRouter>
  )
}
