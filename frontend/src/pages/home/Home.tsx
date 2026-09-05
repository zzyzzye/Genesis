import { Link } from 'react-router-dom'

function Home() {
  return (
    <div className="page" id="top">
      <header className="site-header">
        <Link className="brand" to="/">Genesis<span>.</span></Link>
        <nav aria-label="主导航">
          <Link to="/blog">博客</Link>
          <Link to="/account">账户</Link>
          <Link to="/blog/studio">博客 Studio</Link>
          <Link to="/tools">工具</Link>
          <Link to="/media">影音</Link>
        </nav>
        <span className="module-state">00 / Genesis</span>
      </header>
      <main>
        <section className="intro home-intro" aria-labelledby="home-title">
          <p className="eyebrow">PERSONAL OPERATING SYSTEM</p>
          <h1 id="home-title">把生活里重要的事，放进一个<em>会生长的系统。</em></h1>
          <p className="intro-copy">Genesis 是一个逐步生长的个人系统，从内容沉淀、日常工具到影音记录，把分散的思考和创造连接起来。</p>
        </section>
        <section className="home-systems" aria-labelledby="systems-title">
          <div className="section-heading">
            <div><p className="eyebrow">THREE SYSTEMS</p><h2 id="systems-title">从一个入口，进入三个世界</h2></div>
          </div>
          <div className="home-system-grid">
            <Link className="home-system-card home-system-card--blog" to="/blog"><span>01</span><h3>博客</h3><p>沉淀值得反复回看的想法、文章与长期记录。</p><strong>进入博客 ↗</strong></Link>
            <Link className="home-system-card home-system-card--tools" to="/tools"><span>02</span><h3>工具</h3><p>把重复的工作整理成可以直接使用的小工具。</p><strong>进入工具 ↗</strong></Link>
            <Link className="home-system-card home-system-card--media" to="/media"><span>03</span><h3>影音</h3><p>记录正在发生的现场、声音和影像。</p><strong>进入影音 ↗</strong></Link>
          </div>
        </section>
      </main>
      <footer className="site-footer"><span>Genesis · 个人内容系统</span><span>Build slowly. Keep growing.</span></footer>
    </div>
  )
}


export { Home }
