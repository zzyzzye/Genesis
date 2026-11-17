import type { ReactNode } from 'react'

export function MediaPageHeading({ title, description, meta, actions }: { title: string; description: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return <header className="media-home-intro"><div><h1>{title}</h1><p>{description}</p></div><div className="media-page-heading-actions">{meta && <span>{meta}</span>}{actions}</div></header>
}
