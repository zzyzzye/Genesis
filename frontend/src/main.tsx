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

// 路由生命周期独立于 StrictMode 的重复挂载，保留浏览器返回与离开拦截。
const router = createBrowserRouter([{ path: '*', element: <AppRoutes /> }])

createRoot(rootElement).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
)

