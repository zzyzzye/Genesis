import './MediaPage.css'

import { Link } from 'react-router-dom'

const collections = [
  { number: '01', title: 'LivTV', note: '正在发生的现场', tone: 'live' },
  { number: '02', title: 'Bilibili', note: '持续关注的创作者', tone: 'bilibili' },
  { number: '03', title: 'Archive', note: '看过、听过与记住的', tone: 'archive' },
]

export function MediaPage() {
  return (
    <div className="media-page">
      <header className="media-header">
        <Link to="/" aria-label="返回 Genesis 首页"><span aria-hidden="true">←</span> GENESIS</Link>
        <span className="media-wordmark">SIGNAL / 03</span>
        <Link to="/account" aria-label="打开账户">ACCOUNT ↗</Link>
      </header>
      <main>
        <section className="media-hero" aria-labelledby="media-title">
          <div className="media-orbit" aria-hidden="true"><span /><span /><i /></div>
          <p>PERSONAL MEDIA SIGNAL</p>
          <h1 id="media-title">让喜欢的声音与画面，<br /><em>留下轨迹。</em></h1>
          <div className="media-now"><span>NOW SIGNALING</span><strong>NO ACTIVE STREAM</strong></div>
        </section>
        <section className="media-library" aria-labelledby="media-library-title">
          <div className="media-library-heading"><p>CHANNEL DIRECTORY</p><h2 id="media-library-title">频道</h2></div>
          <div className="media-collection-grid">
            {collections.map((collection) => (
              <article className={`media-collection media-collection--${collection.tone}`} key={collection.title}>
                <span>{collection.number}</span>
                <div><small>COLLECTION</small><h3>{collection.title}</h3><p>{collection.note}</p></div>
                <strong>COMING SOON</strong>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="media-footer"><span>GENESIS SIGNAL ARCHIVE</span><span>OFF AIR · 2026</span></footer>
    </div>
  )
}
