import './ToolboxPage.css'

import { Link } from 'react-router-dom'

const utilities = [
  { code: 'TXT', name: '文本工作台', description: '整理、转换和清洗日常文本。', status: '规划中' },
  { code: 'DEV', name: '开发工具箱', description: '集中放置常用的开发辅助能力。', status: '规划中' },
  { code: 'WEB', name: '网页收藏夹', description: '保存值得长期使用的站点与资源。', status: '规划中' },
]

export function ToolboxPage() {
  return (
    <div className="toolbox-page">
      <aside className="toolbox-rail" aria-label="工具箱标识">
        <Link to="/" aria-label="返回 Genesis 首页">G</Link>
        <span>02</span>
      </aside>
      <main className="toolbox-main">
        <header className="toolbox-header">
          <div><span className="toolbox-status-dot" /> LOCAL TOOLBOX</div>
          <Link to="/account">ACCOUNT ↗</Link>
        </header>
        <section className="toolbox-hero" aria-labelledby="toolbox-title">
          <p>UTILITY WORKSPACE / 02</p>
          <h1 id="toolbox-title">把重复工作，<br /><span>压缩成一次点击。</span></h1>
          <p className="toolbox-lead">这是独立的个人工具箱。每个工具只解决一个明确问题，保持快速、安静、随开随用。</p>
        </section>
        <section className="toolbox-directory" aria-labelledby="toolbox-directory-title">
          <div className="toolbox-section-title"><span>AVAILABLE MODULES</span><h2 id="toolbox-directory-title">工具目录</h2><strong>00 / 03 ONLINE</strong></div>
          <div className="toolbox-grid">
            {utilities.map((tool, index) => (
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
