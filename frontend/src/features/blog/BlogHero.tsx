import './BlogHero.css'

import { useEffect, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { GenesisLogo } from '../../components/GenesisLogo'
import { getDailyJournalQuote, millisecondsUntilNextJournalDay } from './journalQuotes'

export function BlogHero() {
  const [quote, setQuote] = useState(() => getDailyJournalQuote())
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    let timer: number
    function update() {
      window.clearTimeout(timer)
      setQuote(getDailyJournalQuote())
      timer = window.setTimeout(update, millisecondsUntilNextJournalDay() + 100)
    }
    // 后台休眠后重新打开页面，也同步到当天的短句。
    function onVisible() { if (document.visibilityState === 'visible') update() }
    timer = window.setTimeout(update, millisecondsUntilNextJournalDay() + 100)
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  return <section className="blog-hero" aria-label="Genesis Journal 每日一笺">
    {!imageFailed && <img className="blog-hero-image" src="/images/blog/forest.jpg" alt="" width={1587} height={992} fetchPriority="high" onError={() => setImageFailed(true)} />}
    <div className="blog-hero-shade" aria-hidden="true" />
    <div className="blog-hero-brand"><GenesisLogo inverse label="Genesis Journal" /></div>
    <figure className="blog-hero-quote"><blockquote>{quote.split('，').map((line, index, lines) => <span key={line}>{line}{index < lines.length - 1 ? '，' : ''}</span>)}</blockquote><figcaption>每日一笺<span aria-hidden="true"> · </span>原创短句</figcaption></figure>
    <a className="blog-hero-read" href="#articles"><span>向下阅读</span><ArrowDown size={19} aria-hidden="true" /></a>
  </section>
}
