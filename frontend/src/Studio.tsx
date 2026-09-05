import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { StudioIcon } from './studio/StudioIcon'
import { StudioNavigation } from './studio/StudioNavigation'
import { getNavigationGroup, type StudioSection } from './studio/StudioNavigationModel'
import { StudioOverview } from './studio/StudioOverview'

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
      <div className="studio-login-orbit studio-login-orbit--large" aria-hidden="true" />
      <div className="studio-login-orbit studio-login-orbit--small" aria-hidden="true" />
      <section className="studio-login" aria-labelledby="studio-login-title">
        <div className="studio-login-intro">
          <Link className="studio-back-link" to="/">
            <StudioIcon name="arrow-left" /> 返回 Genesis 首页
          </Link>
          <div>
            <p className="eyebrow">GENESIS / AUTHOR SPACE</p>
            <h1 id="studio-login-title">
              把想法，写成
              <em>长期存在</em>的内容。
            </h1>
            <p className="studio-login-copy">在这里整理草稿、发布文章，让每一段思考都有落点。</p>
          </div>
          <p className="studio-login-note">仅限站点作者访问</p>
        </div>

        <div className="studio-login-card">
          <div className="studio-login-card-heading">
            <span className="studio-login-mark" aria-hidden="true">G.</span>
            <div>
              <p>AUTHOR LOGIN</p>
              <h2>进入写作台</h2>
            </div>
          </div>
          <form onSubmit={submit}>
            <label htmlFor="studio-handle">
              <span>账号</span>
              <input
                autoComplete="username"
                autoFocus
                id="studio-handle"
                onChange={(event) => setHandle(event.currentTarget.value)}
                placeholder="输入作者账号"
                required
                value={handle}
              />
            </label>
            <label htmlFor="studio-password">
              <span>密码</span>
              <input
                autoComplete="current-password"
                id="studio-password"
                onChange={(event) => setPassword(event.currentTarget.value)}
                placeholder="输入密码"
                required
                type="password"
                value={password}
              />
            </label>
            {error && <p className="studio-form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit">
              进入写作台 <StudioIcon name="arrow-right" />
            </button>
          </form>
          <p className="studio-login-security">受保护的作者入口 · 登录后可管理文章与草稿</p>
        </div>
      </section>
    </main>
  )
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <article className="studio-preview article-content">
      <div className="studio-preview__label">预览</div>
      <Markdown remarkPlugins={[remarkGfm]}>{content || '开始输入 Markdown，右侧会显示预览。'}</Markdown>
    </article>
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
  onSave: (status: BlogPostStatus) => void
  feedback: string | null
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave(editor.status)
  }

  return (
    <section className="editor-panel" aria-labelledby="editor-title">
      <div className="editor-heading">
        <div>
          <p className="eyebrow">{editor.id ? 'EDITING' : 'NEW DRAFT'}</p>
          <h1 id="editor-title">{editor.id ? '编辑文章' : '新建文章'}</h1>
        </div>
        <div className="editor-heading__meta">
          <span className={`post-status post-status--${editor.status}`}>
            {editor.status === 'published' ? '已发布' : '草稿'}
          </span>
          {editor.id && (
            <button className="text-button text-button--danger" type="button" onClick={onDelete}>
              删除
            </button>
          )}
        </div>
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
        <div className="editor-content-grid">
          <label htmlFor="post-content">
            正文（Markdown）
            <textarea
              className="editor-form__content"
              id="post-content"
              onChange={(event) => onChange({ ...editor, contentMarkdown: event.currentTarget.value })}
              required
              rows={18}
              value={editor.contentMarkdown}
            />
          </label>
          <MarkdownPreview content={editor.contentMarkdown} />
        </div>
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
          <div className="editor-actions__buttons">
            <button
              className="secondary-button"
              disabled={isSaving}
              type="button"
              onClick={() => onSave('draft')}
            >
              保存草稿
            </button>
            <button
              className="primary-button"
              disabled={isSaving}
              type="button"
              onClick={() => onSave('published')}
            >
              {isSaving ? '正在保存…' : '保存并发布'}
            </button>
          </div>
          <span>手动保存 · Markdown 内容会实时预览</span>
        </div>
      </form>
    </section>
  )
}

const sectionMeta: Record<StudioSection, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: 'BLOG CONTROL CENTER', title: '仪表盘', description: '掌握内容状态并快速进入今天的工作。' },
  posts: { eyebrow: 'CONTENT / ARTICLES', title: '文章管理', description: '编辑、整理并发布长期内容。' },
  pages: { eyebrow: 'CONTENT / PAGES', title: '页面管理', description: '规划站点里的固定页面和专题入口。' },
  comments: { eyebrow: 'CONTENT / COMMENTS', title: '评论管理', description: '查看读者反馈与讨论。' },
  attachments: { eyebrow: 'CONTENT / ASSETS', title: '附件管理', description: '统一整理图片、文件与媒体素材。' },
  links: { eyebrow: 'CONTENT / LINKS', title: '链接管理', description: '维护站点内外的重要连接。' },
  themes: { eyebrow: 'APPEARANCE / THEMES', title: '主题外观', description: '调整站点的视觉风格与展示方式。' },
  menus: { eyebrow: 'APPEARANCE / MENUS', title: '菜单管理', description: '组织访客使用的导航结构。' },
  users: { eyebrow: 'SYSTEM / USERS', title: '用户管理', description: '管理作者资料与访问权限。' },
  settings: { eyebrow: 'SYSTEM / SETTINGS', title: '系统设置', description: '配置博客系统的基础信息。' },
}

function ContextSidebar({
  activeSection,
  onChange,
}: {
  activeSection: StudioSection
  onChange: (section: StudioSection) => void
}) {
  const group = getNavigationGroup(activeSection)

  if (!group) {
    return null
  }

  return (
    <aside className="studio-context-sidebar" aria-label={`三级${group.label}菜单`}>
      <header className="studio-context-header">
        <div><span className="studio-level-mark">三级</span><p>FUNCTION / {group.id.toUpperCase()}</p><h2>{group.label}</h2></div>
        <span>{group.items.length} 项</span>
      </header>
      <nav className="studio-context-menu" aria-label={`${group.label}功能菜单`}>
        {group.items.map((item) => (
          <button className={activeSection === item.id ? 'is-active' : ''} type="button" key={item.id} onClick={() => onChange(item.id)}>
            <StudioIcon className="studio-context-menu__icon" name={item.icon} />
            <div><strong>{item.label}</strong><small>{item.description}</small></div>
            <StudioIcon name="chevron" />
          </button>
        ))}
      </nav>
      <div className="studio-context-note studio-context-note--muted">
        <StudioIcon name="spark" />
        <div><strong>三级功能菜单</strong><p>这里负责切换具体功能，右侧区域展示对应的数据和操作。</p></div>
      </div>
    </aside>
  )
}

function PostsIndex({
  editor,
  posts,
  onCreatePost,
  onOpenPost,
}: {
  editor: EditorState
  posts: BlogPostAdmin[]
  onCreatePost: () => void
  onOpenPost: (post: BlogPostAdmin) => void
}) {
  const published = posts.filter((post) => post.status === 'published').length
  const drafts = posts.length - published

  return (
    <aside className="studio-post-index" aria-label="文章内容列表">
      <header className="studio-post-index__header">
        <div><p>CONTENT / ARTICLES</p><h2>文章</h2></div>
        <span>{posts.length} 篇</span>
      </header>
      <button className="new-post-button" type="button" onClick={onCreatePost}>
        <StudioIcon name="plus" /> 新建文章
      </button>
      <div className="studio-context-filters" aria-label="文章筛选">
        <button className="is-active" type="button">全部 <span>{posts.length}</span></button>
        <button type="button">已发布 <span>{published}</span></button>
        <button type="button">草稿 <span>{drafts}</span></button>
      </div>
      <div className="studio-content-list">
        {posts.map((post) => (
          <button
            className={editor.id === post.id ? 'studio-content-list__item is-selected' : 'studio-content-list__item'}
            key={post.id}
            type="button"
            onClick={() => onOpenPost(post)}
          >
            <span className={`post-status post-status--${post.status}`}>{post.status === 'published' ? '已发布' : '草稿'}</span>
            <strong>{post.title}</strong>
            <small>{post.excerpt || '暂无摘要'}</small>
            <time>{post.updated_at.slice(0, 10)}</time>
          </button>
        ))}
        {posts.length === 0 && <p className="studio-context-empty">还没有文章，创建第一篇草稿吧。</p>}
      </div>
    </aside>
  )
}

function PostsWorkspace({
  editor,
  feedback,
  isSaving,
  posts,
  onChange,
  onCreatePost,
  onDelete,
  onOpenPost,
  onSave,
}: {
  editor: EditorState
  feedback: string | null
  isSaving: boolean
  posts: BlogPostAdmin[]
  onChange: (editor: EditorState) => void
  onCreatePost: () => void
  onDelete: () => void
  onOpenPost: (post: BlogPostAdmin) => void
  onSave: (status: BlogPostStatus) => void
}) {
  return (
    <div className="studio-posts-workspace">
      <PostsIndex editor={editor} onCreatePost={onCreatePost} onOpenPost={onOpenPost} posts={posts} />
      <Editor editor={editor} feedback={feedback} isSaving={isSaving} onChange={onChange} onDelete={onDelete} onSave={onSave} />
    </div>
  )
}

function SectionPlaceholder({ section }: { section: Exclude<StudioSection, 'overview' | 'posts'> }) {
  const meta = sectionMeta[section]
  return (
    <section className="studio-placeholder-panel">
      <span className="studio-placeholder-icon"><StudioIcon name="spark" /></span>
      <p>{meta.eyebrow}</p>
      <h2>{meta.title}</h2>
      <span>{meta.description}</span>
      <div className="studio-placeholder-rule" />
      <small>界面结构已经就位，业务能力将在对应阶段接入。</small>
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
  const [activeSection, setActiveSection] = useState<StudioSection>('overview')
  const [editor, setEditor] = useState<EditorState>(() => createEmptyEditor())
  const [managedPosts, setManagedPosts] = useState(posts)
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  function createPost() {
    setActiveSection('posts')
    setEditor(createEmptyEditor())
    setFeedback(null)
  }

  function openPost(post: BlogPostAdmin) {
    setActiveSection('posts')
    setEditor(toEditor(post))
    setFeedback(null)
  }

  async function savePost(status: BlogPostStatus) {
    let payload: BlogPostWrite
    try {
      payload = toPayload({ ...editor, status })
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '文章信息不完整。')
      return
    }

    setIsSaving(true)
    setFeedback(null)
    try {
      const savedPost = editor.id === null
        ? await createAdminBlogPost(token, payload)
        : await updateAdminBlogPost(token, editor.id, payload)
      setManagedPosts((currentPosts) => [savedPost, ...currentPosts.filter((post) => post.id !== savedPost.id)])
      setEditor(toEditor(savedPost))
      setFeedback('已保存。')
    } catch {
      setFeedback('保存失败，请检查必填项、Slug 和网络连接。')
    } finally {
      setIsSaving(false)
    }
  }

  async function deletePost() {
    if (editor.id === null) return
    if (!window.confirm(`确定删除「${editor.title}」吗？此操作不可恢复。`)) return
    try {
      await deleteAdminBlogPost(token, editor.id)
      setManagedPosts((currentPosts) => currentPosts.filter((post) => post.id !== editor.id))
      setEditor(createEmptyEditor())
      setFeedback('文章已删除。')
    } catch {
      setFeedback('删除失败，请稍后重试。')
    }
  }

  const meta = sectionMeta[activeSection]

  return (
    <div className={activeSection === 'overview' ? 'studio-app-shell studio-app-shell--overview' : 'studio-app-shell'}>
      <StudioNavigation activeSection={activeSection} onChange={setActiveSection} onLogout={onLogout} user={user} />
      {activeSection !== 'overview' && <ContextSidebar activeSection={activeSection} onChange={setActiveSection} />}

      <div className="studio-workspace">
        <header className="studio-topbar">
          <div className="studio-topbar__title">
            <span className="studio-mobile-level">内容工作区</span>
            <div><p>{meta.eyebrow}</p><h1>{meta.title}</h1><small>{meta.description}</small></div>
          </div>
          <div className="studio-topbar__actions">
            <button type="button" aria-label="通知"><StudioIcon name="bell" /><span>2</span></button>
            <Link className="studio-topbar__site-link" to="/blog"><StudioIcon name="eye" />查看站点 <StudioIcon name="arrow-up-right" /></Link>
          </div>
        </header>

        <main className={activeSection === 'posts' ? 'studio-content studio-content--editor' : 'studio-content'}>
          {activeSection === 'overview' && (
            <StudioOverview posts={managedPosts} onChange={setActiveSection} onCreatePost={createPost} onOpenPost={openPost} />
          )}
          {activeSection === 'posts' && (
            <PostsWorkspace
              editor={editor}
              feedback={feedback}
              isSaving={isSaving}
              onChange={setEditor}
              onCreatePost={createPost}
              onDelete={() => void deletePost()}
              onOpenPost={openPost}
              onSave={(status) => void savePost(status)}
              posts={managedPosts}
            />
          )}
          {activeSection !== 'overview' && activeSection !== 'posts' && <SectionPlaceholder section={activeSection} />}
        </main>
      </div>
    </div>
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
