import { useEffect, useState } from 'react'
import { api, type Project } from './api'

export type MediaProjectCollection = {
  items: Project[]
  loading: boolean
  error: string
  reload: () => void
  update: (project: Project) => void
}

/** 页面框架保留作品列表；返回时后台更新，避免导航清空已有封面。 */
export function useMediaProjects(enabled: boolean): MediaProjectCollection {
  const [state, setState] = useState({ items: [] as Project[], loading: true, error: '' })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let active = true
    void api<Project[]>('/projects').then(items => {
      if (active) setState({ items: [...items].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)), loading: false, error: '' })
    }).catch((reason: Error) => {
      if (active) setState(previous => ({ ...previous, loading: false, error: reason.message }))
    })
    return () => { active = false }
  }, [enabled, revision])

  return {
    ...state,
    reload: () => { setState(previous => ({ ...previous, loading: true })); setRevision(value => value + 1) },
    update: project => setState(previous => ({ ...previous, items: previous.items.map(item => item.id === project.id ? project : item) })),
  }
}
