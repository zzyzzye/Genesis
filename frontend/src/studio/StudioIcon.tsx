import type { SVGProps } from 'react'

export type StudioIconName =
  | 'articles'
  | 'attachment'
  | 'bell'
  | 'chevron'
  | 'comments'
  | 'dashboard'
  | 'eye'
  | 'link'
  | 'logout'
  | 'media'
  | 'menu'
  | 'pages'
  | 'palette'
  | 'plus'
  | 'search'
  | 'settings'
  | 'spark'
  | 'tools'
  | 'user'

const paths: Record<StudioIconName, React.ReactNode> = {
  articles: <><path d="M6 4.75h10.5A1.5 1.5 0 0 1 18 6.25v11H7.5A1.5 1.5 0 0 1 6 15.75z"/><path d="M6 6.25A1.5 1.5 0 0 0 4.5 4.75H4v11h2M9 8h6M9 11h6M9 14h4"/></>,
  attachment: <path d="m9.5 12.5 4.75-4.75a2.12 2.12 0 0 1 3 3L10.8 17.2a4 4 0 0 1-5.65-5.65l6.1-6.1a2.75 2.75 0 0 1 3.9 3.9L9.4 15.1a1.5 1.5 0 0 1-2.12-2.12l5-5"/>,
  bell: <><path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 6 2.25 6 2.25 6H4.25s2.25 0 2.25-6Z"/><path d="M10 18.25a2.2 2.2 0 0 0 4 0"/></>,
  chevron: <path d="m9 6 6 6-6 6"/>,
  comments: <><path d="M5 5.5h14v10H9l-4 3z"/><path d="M8.5 9.5h.01M12 9.5h.01M15.5 9.5h.01"/></>,
  dashboard: <><circle cx="12" cy="12" r="8.5"/><path d="m12 12 4-4M7.5 14.5h.01M8 9h.01M12 6.5h.01M16 15h.01"/></>,
  eye: <><path d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5Z"/><circle cx="12" cy="12" r="2"/></>,
  link: <><path d="m9.5 14.5-1 1a3.54 3.54 0 0 1-5-5l3-3a3.54 3.54 0 0 1 5 0"/><path d="m14.5 9.5 1-1a3.54 3.54 0 0 1 5 5l-3 3a3.54 3.54 0 0 1-5 0M8.5 12h7"/></>,
  logout: <><path d="M10 5H5.5v14H10M14 8l4 4-4 4M8 12h10"/></>,
  media: <><rect x="4" y="5" width="16" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></>,
  menu: <><path d="M5 7h14M5 12h9M5 17h14"/><circle cx="17" cy="12" r="2"/></>,
  pages: <><path d="M7 3.75h8l3 3v13.5H7z"/><path d="M15 3.75v3h3M10 11h5M10 14h5M10 17h3"/></>,
  palette: <><path d="M12 4a8 8 0 0 0 0 16h1.3a1.7 1.7 0 0 0 1.4-2.65 1.5 1.5 0 0 1 1.25-2.35H17a3 3 0 0 0 3-3c0-4.4-3.6-8-8-8Z"/><circle cx="8.5" cy="9" r=".7" fill="currentColor"/><circle cx="12" cy="7" r=".7" fill="currentColor"/><circle cx="15.5" cy="9" r=".7" fill="currentColor"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.12-1.3l2-1.55-2-3.45-2.45 1a7 7 0 0 0-2.25-1.3L13.8 2.8h-4l-.38 2.6a7 7 0 0 0-2.25 1.3l-2.45-1-2 3.45 2 1.55A7 7 0 0 0 4.6 12c0 .44.04.87.12 1.3l-2 1.55 2 3.45 2.45-1a7 7 0 0 0 2.25 1.3l.38 2.6h4l.38-2.6a7 7 0 0 0 2.25-1.3l2.45 1 2-3.45-2-1.55c.08-.43.12-.86.12-1.3Z"/></>,
  spark: <><path d="m12 3 1.2 4.2L17 9l-3.8 1.8L12 15l-1.2-4.2L7 9l3.8-1.8z"/><path d="m18.5 15 .6 2.1L21 18l-1.9.9-.6 2.1-.6-2.1L16 18l1.9-.9zM5.5 4l.6 2.1L8 7l-1.9.9L5.5 10l-.6-2.1L3 7l1.9-.9z"/></>,
  tools: <><path d="m14.5 5.5 4 4M13 7l4 4M5 19l7.5-7.5M4 4l4 1 2 2-3 3-2-2zM14 14l2-2 4 4-2 2z"/></>,
  user: <><circle cx="12" cy="8" r="3.25"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></>,
}

export function StudioIcon({ name, ...props }: { name: StudioIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" {...props}>
      {paths[name]}
    </svg>
  )
}
