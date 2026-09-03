import { type FormEvent, useEffect, useState } from 'react'

import {
  createAdminBlogPost,
  deleteAdminBlogPost,
  getAdminBlogPosts,
  getCurrentUser,
  login,
  updateAdminBlogPost,
  type BlogPostAdmin,
  type BlogPostStatus,
  type BlogPostWrite,
  type BlogTag,
  type BlogTagWrite,
  type CurrentUser,
} from './lib/api'

interface EditorState {
  id: string | null
  slug: string
  title: string
  excerpt: string
  contentMarkdown: string
  coverImageUrl: string
  status: BlogPostStatus
  isFeatured: boolean
  readTimeMinutes: number
  tagsText: string
}

type StudioState =
  | { status: 'login'; error: string | null }
  | { status: 'loading' }
  | { status: 'ready'; user: CurrentUser; posts: BlogPostAdmin[] }
  | { status: 'error' }

function createEmptyEditor(): EditorState {
  return {
    id: null,
    slug: '',
    title: '',
    excerpt: '',
    contentMarkdown: '# 新文章\n\n从这里开始写。',
    coverImageUrl: '',
    status: 'draft',
    isFeatured: false,
    readTimeMinutes: 3,
    tagsText: '',
  }
}

function formatTags(tags: BlogTag[]): string {
  return tags.map((tag) => `${tag.name}:${tag.slug}`).join(', ')
}

function toEditor(post: BlogPostAdmin): EditorState {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    contentMarkdown: post.content_markdown,
    coverImageUrl: post.cover_image_url ?? '',
    status: post.status,
    isFeatured: post.is_featured,
    readTimeMinutes: post.read_time_minutes,
    tagsText: formatTags(post.tags),
  }
}

function parseTags(value: string): BlogTagWrite[] {
  if (value.trim() === '') {
    return []
  }

  const tags = value.split(',').map((entry) => {
    const [name, slug, ...rest] = entry.split(':').map((part) => part.trim())
    if (!name || !slug || rest.length > 0 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error('标签请使用“名称:english-slug”的格式，并以英文逗号分隔。')
    }
    return { name, slug }
  })

  if (new Set(tags.map((tag) => tag.slug)).size !== tags.length) {
    throw new Error('同一篇文章不能重复使用同一个标签。')
  }
  return tags
}

function toPayload(editor: EditorState): BlogPostWrite {
  return {
    slug: editor.slug.trim(),
    title: editor.title.trim(),
    excerpt: editor.excerpt.trim(),
    content_markdown: editor.contentMarkdown.trim(),
    cover_image_url: editor.coverImageUrl.trim() || null,
    status: editor.status,
    is_featured: editor.isFeatured,
    read_time_minutes: editor.readTimeMinutes,
    tags: parseTags(editor.tagsText),
  }
}

function LoginForm({ onLogin, error }: { onLogin: (handle: string, password: string) => void; error: string | null }) {
  const [handle, setHandle] = useState('genesis')
  const [password, setPassword] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onLogin(handle, password)
  }

  return (
    <main className="studio-login-shell">
      <section className="studio-login" aria-labelledby="studio-login-title">
        <p className="eyebrow">GENESIS / AUTHOR SPACE</p>
        <h1 id="studio-login-title">写作台</h1>
        <p>仅站点作者可以管理文章、草稿和标签。</p>
        <form onSubmit={submit}>
          <label htmlFor="studio-handle">
            账号
            <input
              autoComplete="username"
              id="studio-handle"
              onChange={(event) => setHandle(event.currentTarget.value)}
              required
              value={handle}
            />
          </label>
          <label htmlFor="studio-password">
            密码
            <input
              autoComplete="current-password"
              id="studio-password"
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error && <p className="studio-form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit">
            进入写作台
          </button>
        </form>
      </section>
    </main>
  )
}

function Editor({
  editor,
  isSaving,
  onChange,
  onDelete,
  onSave,
  feedback,
}: {
  editor: EditorState
  isSaving: boolean
  onChange: (editor: EditorState) => void
  onDelete: () => void
  onSave: () => void
  feedback: string | null
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave()
  }

  return (
    <section className="editor-panel" aria-labelledby="editor-title">
      <div className="editor-heading">
        <div>
          <p className="eyebrow">{editor.id ? 'EDITING' : 'NEW DRAFT'}</p>
          <h2 id="editor-title">{editor.id ? '编辑文章' : '新建文章'}</h2>
        </div>
        {editor.id && (
          <button className="text-button text-button--danger" type="button" onClick={onDelete}>
            删除
          </button>
        )}
      </div>
      <form className="editor-form" onSubmit={submit}>
        <div className="editor-form__grid">
          <label htmlFor="post-title">
            标题
            <input
              id="post-title"
              onChange={(event) => onChange({ ...editor, title: event.currentTarget.value })}
              required
              value={editor.title}
            />
          </label>
          <label htmlFor="post-slug">
            URL Slug
            <input
              id="post-slug"
              onChange={(event) => onChange({ ...editor, slug: event.currentTarget.value })}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              required
              value={editor.slug}
            />
          </label>
        </div>
        <label htmlFor="post-excerpt">
          摘要
          <textarea
            id="post-excerpt"
            onChange={(event) => onChange({ ...editor, excerpt: event.currentTarget.value })}
            required
            rows={3}
            value={editor.excerpt}
          />
        </label>
        <label htmlFor="post-content">
          正文（Markdown）
          <textarea
            className="editor-form__content"
            id="post-content"
            onChange={(event) => onChange({ ...editor, contentMarkdown: event.currentTarget.value })}
            required
            rows={14}
            value={editor.contentMarkdown}
          />
        </label>
        <div className="editor-form__grid">
          <label htmlFor="post-tags">
            标签
            <input
              id="post-tags"
              onChange={(event) => onChange({ ...editor, tagsText: event.currentTarget.value })}
              placeholder="产品:product, 工程:engineering"
              value={editor.tagsText}
            />
          </label>
          <label htmlFor="post-cover">
            封面链接（可选）
            <input
              id="post-cover"
              onChange={(event) => onChange({ ...editor, coverImageUrl: event.currentTarget.value })}
              type="url"
              value={editor.coverImageUrl}
            />
          </label>
        </div>
        <div className="editor-options">
          <label htmlFor="post-status">
            状态
            <select
              id="post-status"
              onChange={(event) =>
                onChange({ ...editor, status: event.currentTarget.value as BlogPostStatus })
              }
              value={editor.status}
            >
              <option value="draft">草稿</option>
              <option value="published">公开发布</option>
            </select>
          </label>
          <label htmlFor="post-reading-time">
            阅读分钟
            <input
              id="post-reading-time"
              min="1"
              onChange={(event) =>
                onChange({ ...editor, readTimeMinutes: Number(event.currentTarget.value) || 1 })
              }
              type="number"
              value={editor.readTimeMinutes}
            />
          </label>
          <label className="checkbox-label" htmlFor="post-featured">
            <input
              checked={editor.isFeatured}
              id="post-featured"
              onChange={(event) => onChange({ ...editor, isFeatured: event.currentTarget.checked })}
              type="checkbox"
            />
            设为精选
          </label>
        </div>
        {feedback && <p className="studio-form-error" role="alert">{feedback}</p>}
        <div className="editor-actions">
          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? '正在保存…' : editor.status === 'published' ? '保存并发布' : '保存草稿'}
          </button>
          <span>文章以 Markdown 保存，公开端会安全地按文本展示。</span>
        </div>
      </form>
    </section>
  )
}

function Dashboard({
  posts,
  token,
  user,
  onLogout,
}: {
  posts: BlogPostAdmin[]
  token: string
  user: CurrentUser
  onLogout: () => void
}) {
  const [editor, setEditor] = useState<EditorState>(() => createEmptyEditor())
  const [managedPosts, setManagedPosts] = useState(posts)
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  async function savePost() {
    let payload: BlogPostWrite
    try {
      payload = toPayload(editor)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '文章信息不完整。')
      return
    }

    setIsSaving(true)
    setFeedback(null)
    try {
      const savedPost =
        editor.id === null
          ? await createAdminBlogPost(token, payload)
          : await updateAdminBlogPost(token, editor.id, payload)
      setManagedPosts((currentPosts) => [
        savedPost,
        ...currentPosts.filter((post) => post.id !== savedPost.id),
      ])
      setEditor(toEditor(savedPost))
      setFeedback('已保存。')
    } catch {
      setFeedback('保存失败，请检查必填项、Slug 和网络连接。')
    } finally {
      setIsSaving(false)
    }
  }

  async function deletePost() {
    if (editor.id === null) {
      return
    }
    if (!window.confirm(`确定删除「${editor.title}」吗？此操作不可恢复。`)) {
      return
    }
    try {
      await deleteAdminBlogPost(token, editor.id)
      setManagedPosts((currentPosts) => currentPosts.filter((post) => post.id !== editor.id))
      setEditor(createEmptyEditor())
      setFeedback('文章已删除。')
    } catch {
      setFeedback('删除失败，请稍后重试。')
    }
  }

  return (
    <main className="studio-dashboard">
      <section className="studio-sidebar" aria-label="文章列表">
        <div className="studio-sidebar__top">
          <div>
            <p className="eyebrow">AUTHOR / {user.handle}</p>
            <h1>写作台</h1>
          </div>
          <button className="text-button" type="button" onClick={onLogout}>
            退出
          </button>
        </div>
        <button
          className="new-post-button"
          type="button"
          onClick={() => {
            setEditor(createEmptyEditor())
            setFeedback(null)
          }}
        >
          + 新建文章
        </button>
        <div className="post-list">
          {managedPosts.map((post) => (
            <button
              className={editor.id === post.id ? 'post-list__item is-selected' : 'post-list__item'}
              key={post.id}
              type="button"
              onClick={() => {
                setEditor(toEditor(post))
                setFeedback(null)
              }}
            >
              <span className={`post-status post-status--${post.status}`}>
                {post.status === 'published' ? '已发布' : '草稿'}
              </span>
              <strong>{post.title}</strong>
              <small>{post.updated_at.slice(0, 10)}</small>
            </button>
          ))}
        </div>
      </section>
      <Editor
        editor={editor}
        feedback={feedback}
        isSaving={isSaving}
        onChange={setEditor}
        onDelete={() => void deletePost()}
        onSave={() => void savePost()}
      />
    </main>
  )
}

export function Studio() {
  const [state, setState] = useState<StudioState>({ status: 'login', error: null })
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    if (token === null) {
      return
    }

    let cancelled = false
    void Promise.all([getCurrentUser(token), getAdminBlogPosts(token)])
      .then(([user, posts]) => {
        if (!cancelled) {
          setState({ status: 'ready', user, posts })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setToken(null)
          setState({ status: 'login', error: '登录状态无效，请重新登录。' })
        }
      })

    return () => {
      cancelled = true
    }
  }, [token])

  function handleLogin(handle: string, password: string) {
    setState({ status: 'loading' })
    void login(handle, password)
      .then((data) => {
        setToken(data.access_token)
      })
      .catch(() => setState({ status: 'login', error: '账号或密码错误。' }))
  }

  function handleLogout() {
    setToken(null)
    setState({ status: 'login', error: null })
  }

  if (state.status === 'loading') {
    return <main className="studio-loading">正在进入写作台…</main>
  }

  if (state.status === 'ready' && token !== null) {
    return <Dashboard onLogout={handleLogout} posts={state.posts} token={token} user={state.user} />
  }

  if (state.status === 'login') {
    return <LoginForm error={state.error} onLogin={handleLogin} />
  }

  return <main className="studio-loading">页面状态异常，请刷新后重试。</main>
}
