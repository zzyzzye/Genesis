import './ToolsPage.css'

import { Link } from 'react-router-dom'

const tools = [
  { code: 'TXT', name: '文本工作台', description: '整理、转换和清洗日常文本。', status: '规划中' },
  { code: 'DEV', name: '开发工具箱', description: '集中放置常用的开发辅助能力。', status: '规划中' },
  { code: 'WEB', name: '网页收藏夹', description: '保存值得长期使用的站点与资源。', status: '规划中' },
]

export function ToolsPage() {
  return (
    <div className="tools-page">
      <aside className="tools-rail" aria-label="工具系统标识">
        <Link to="/" aria-label="返回 Genesis 首页">G</Link>
        <span>02</span>
      </aside>
      <main className="tools-main">
        <header className="tools-header">
          <div><span className="tools-status-dot" /> LOCAL TOOLKIT</div>
          <Link to="/account">ACCOUNT ↗</Link>
        </header>
        <section className="tools-hero" aria-labelledby="tools-title">
          <p>UTILITY WORKSPACE / 02</p>
          <h1 id="tools-title">把重复工作，<br /><span>压缩成一次点击。</span></h1>
          <p className="tools-lead">这是独立的个人工具系统。每个工具只解决一个明确问题，保持快速、安静、随开随用。</p>
        </section>
        <section className="tools-directory" aria-labelledby="tools-directory-title">
          <div className="tools-section-title"><span>AVAILABLE MODULES</span><h2 id="tools-directory-title">工具目录</h2><strong>00 / 03 ONLINE</strong></div>
          <div className="tools-grid">
            {tools.map((tool, index) => (
              <article className="tool-tile" key={tool.code}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div className="tool-glyph" aria-hidden="true">{tool.code}</div>
                <h3>{tool.name}</h3>
                <p>{tool.description}</p>
                <small>{tool.status}</small>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
