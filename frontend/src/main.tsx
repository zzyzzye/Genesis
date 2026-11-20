import '../styles/base.css'
import '../styles/shared.css'
import '../styles/article-content.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router-dom'

import { App, AppRoutes } from './App'


const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('找不到应用挂载节点 #root')
}

// 普通首页刷新应展示新的首屏，不能重放上次「向下阅读」留下的锚点。
// 在路由初始化前归一化；主动打开锚点、筛选结果和站内返回仍保留原定位。
const entryUrl = new URL(window.location.href)
const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
const readingQuery = Boolean(entryUrl.searchParams.get('q')?.trim() || entryUrl.searchParams.get('tag'))
  || Number.parseInt(entryUrl.searchParams.get('page') ?? '1', 10) > 1
if (entryUrl.pathname === '/blog' && navigation?.type === 'reload' && !readingQuery) {
  window.history.replaceState(window.history.state, '', `${entryUrl.pathname}${entryUrl.search}#top`)
}

// 路由生命周期独立于 StrictMode 的重复挂载，保留浏览器返回与离开拦截。
const router = createBrowserRouter([{ path: '*', element: <AppRoutes /> }])

createRoot(rootElement).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
)

