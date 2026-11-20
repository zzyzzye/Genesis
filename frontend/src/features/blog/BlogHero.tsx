import './BlogHero.css'

import { useEffect, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { GenesisLogo } from '../../components/GenesisLogo'
import { pickJournalScene, readPreviousJournalSelection, rememberJournalSelection } from './journalQuotes'

export function BlogHero() {
  const location = useLocation()
  const [{ image, quote }] = useState(() => pickJournalScene(readPreviousJournalSelection()))
  const [imageSrc, setImageSrc] = useState<string | null>(image.src)

  useEffect(() => {
    rememberJournalSelection({ imageId: image.id, quoteId: quote.id })
  }, [image.id, quote.id])

  return <section className="blog-hero" aria-label="Genesis Journal 首屏">
    {imageSrc && <img key={imageSrc} className="blog-hero-image" src={imageSrc} alt="" style={{ objectPosition: image.position }} fetchPriority="high" onError={() => setImageSrc(imageSrc === '/images/blog/forest.jpg' ? null : '/images/blog/forest.jpg')} />}
    <div className="blog-hero-shade" aria-hidden="true" />
    <div className="blog-hero-brand"><GenesisLogo inverse label="Genesis Journal" /></div>
    <figure className="blog-hero-quote"><blockquote cite={quote.source}>{quote.text.split('，').map((line, index, lines) => <span key={line}>{line}{index < lines.length - 1 ? '，' : ''}</span>)}</blockquote><figcaption>{quote.source ? <a href={quote.source} target="_blank" rel="noopener noreferrer" title="查看原文出处（新窗口）">{quote.author}<span aria-hidden="true"> · </span>《{quote.work}》</a> : <span>Genesis<span aria-hidden="true"> · </span>原创短句</span>}</figcaption></figure>
    <Link className="blog-hero-read" to={{ search: location.search, hash: '#articles' }} state={{ smoothBlogScroll: true }}><span className="blog-hero-read-label">向下阅读</span><span className="blog-hero-read-arrow" aria-hidden="true"><ArrowDown size={19} /></span></Link>
  </section>
}
