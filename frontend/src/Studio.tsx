import { type FormEvent, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  imagePlugin,
  KitchenSinkToolbar,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'

import { clearStoredAuthToken, getStoredAuthToken, storeAuthToken, studioAuthTokenKey } from './lib/auth'
import { StudioIcon } from './studio/StudioIcon'
import { StudioNavigation } from './studio/StudioNavigation'
import type { StudioSection } from './studio/StudioNavigationModel'
import { StudioAssistant } from './studio/StudioAssistant'
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

function slugifyFilename(filename: string): string {
  return filename.replace(/\.md$/i, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function parseMarkdownImport(filename: string, content: string): { title: string; excerpt: string; slug: string } {
  const lines = content.split(/\r?\n/)
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line.trim()))
  const titleLine = titleIndex >= 0 ? lines[titleIndex] ?? '' : ''
  const title = titleIndex >= 0 ? titleLine.replace(/^#\s+/, '').trim() : filename.replace(/\.md$/i, '')
  const body = lines.filter((_, index) => index !== titleIndex).join('\n').trim()
  const paragraphs = body.split(/\n\s*\n/).map((paragraph) => paragraph.replace(/^#{2,6}\s+/, '').replace(/[*_`>#-]/g, '').trim()).filter(Boolean)
  return { title, excerpt: paragraphs[0]?.slice(0, 500) || title, slug: slugifyFilename(filename) }
}

function PostSettingsModal({
  editor,
  feedback,
  isSaving,
  onChange,
  onClose,
  onDelete,
  onImportMarkdown,
  onSave,
}: {
  editor: EditorState
  feedback: string | null
  isSaving: boolean
  onChange: (editor: EditorState) => void
  onClose: () => void
  onDelete: () => void
  onImportMarkdown: (file: File) => void
  onSave: (status: BlogPostStatus) => void
}) {
  return (
    <div className="markdown-settings-modal" role="dialog" aria-modal="true" aria-labelledby="markdown-settings-title">
      <section className="markdown-settings-modal__surface">
        <header className="markdown-settings-modal__header">
          <div>
            <p className="eyebrow">ARTICLE SETTINGS</p>
            <h2 id="markdown-settings-title">文章设置</h2>
          </div>
          <button className="text-button" type="button" onClick={onClose}>关闭</button>
        </header>
        <div className="markdown-settings-modal__body">
          <div className="editor-form__grid">
            <label htmlFor="settings-slug">
              URL Slug
              <input id="settings-slug" onChange={(event) => onChange({ ...editor, slug: event.currentTarget.value })} pattern="[a-z0-9]+(-[a-z0-9]+)*" required value={editor.slug} />
            </label>
            <label htmlFor="settings-cover">
              封面链接（可选）
              <input id="settings-cover" onChange={(event) => onChange({ ...editor, coverImageUrl: event.currentTarget.value })} type="url" value={editor.coverImageUrl} />
            </label>
          </div>
          <label htmlFor="settings-excerpt">
            摘要
            <textarea id="settings-excerpt" onChange={(event) => onChange({ ...editor, excerpt: event.currentTarget.value })} required rows={4} value={editor.excerpt} />
          </label>
          <label htmlFor="settings-tags">
            标签
            <input id="settings-tags" onChange={(event) => onChange({ ...editor, tagsText: event.currentTarget.value })} placeholder="产品:product, 工程:engineering" value={editor.tagsText} />
          </label>
          <div className="editor-options">
            <label htmlFor="settings-reading-time">
              阅读分钟
              <input id="settings-reading-time" min="1" onChange={(event) => onChange({ ...editor, readTimeMinutes: Number(event.currentTarget.value) || 1 })} type="number" value={editor.readTimeMinutes} />
            </label>
            <label className="checkbox-label" htmlFor="settings-featured">
              <input checked={editor.isFeatured} id="settings-featured" onChange={(event) => onChange({ ...editor, isFeatured: event.currentTarget.checked })} type="checkbox" />
              设为精选
            </label>
          </div>
          <label className="markdown-import-control">
            <span>导入 Markdown 文件</span>
            <small>导入后会覆盖当前标题、摘要、Slug 和正文。</small>
            <input accept=".md,text/markdown" type="file" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onImportMarkdown(file); event.currentTarget.value = '' }} />
          </label>
          {feedback && <p className="studio-form-error" role="alert">{feedback}</p>}
        </div>
        <footer className="markdown-settings-modal__footer">
          <button className="text-button text-button--danger" disabled={!editor.id || isSaving} type="button" onClick={onDelete}>删除文章</button>
          <div>
            <button className="secondary-button" disabled={isSaving} type="button" onClick={() => onSave('draft')}>保存草稿</button>
            <button className="primary-button" disabled={isSaving} type="button" onClick={() => onSave('published')}>{isSaving ? '正在保存…' : '保存并发布'}</button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function MarkdownEditor({
  editor,
  feedback,
  isSaving,
  onBack,
  onChange,
  onDelete,
  onPreview,
  onSave,
}: {
  editor: EditorState
  feedback: string | null
  isSaving: boolean
  onBack: () => void
  onChange: (editor: EditorState) => void
  onDelete: () => void
  onPreview: () => void
  onSave: (status: BlogPostStatus) => void
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  function importMarkdown(file: File) {
    if (!file.name.toLowerCase().endsWith('.md')) {
      window.alert('请选择 Markdown 文件（.md）。')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : ''
      const metadata = parseMarkdownImport(file.name, content)
      onChange({ ...editor, id: null, title: metadata.title, excerpt: metadata.excerpt, slug: metadata.slug, contentMarkdown: content, status: 'draft' })
    }
    reader.onerror = () => window.alert('Markdown 文件读取失败，请重试。')
    reader.readAsText(file)
  }

  return (
    <section className="markdown-editor" aria-labelledby="markdown-editor-title">
      <header className="markdown-editor__header">
        <div className="markdown-editor__identity">
          <button className="text-button" type="button" onClick={onBack}>← 返回文章列表</button>
          <div className="markdown-editor__title-row">
            <span className="markdown-editor__eyebrow">MDX MARKDOWN WORKSPACE</span>
            <span className={`post-status post-status--${editor.status}`}>{editor.status === 'published' ? '已发布' : '草稿'}</span>
          </div>
          <input aria-label="文章标题" className="markdown-editor__title" id="markdown-editor-title" onChange={(event) => onChange({ ...editor, title: event.currentTarget.value })} placeholder="输入文章标题" value={editor.title} />
        </div>
        <div className="markdown-editor__actions">
          <button className="secondary-button" type="button" onClick={onPreview}><StudioIcon name="eye" /> 预览</button>
          <button className="secondary-button" type="button" onClick={() => setIsSettingsOpen(true)}><StudioIcon name="settings" /> 设置</button>
          <button className="secondary-button" disabled={isSaving} type="button" onClick={() => onSave('draft')}>保存</button>
          <button className="primary-button" disabled={isSaving} type="button" onClick={() => onSave('published')}>{isSaving ? '发布中…' : '发布'}</button>
        </div>
      </header>
      {feedback && <p className="markdown-editor__feedback" role="status">{feedback}</p>}
      <div className="markdown-editor__workspace markdown-editor__workspace--mdx">
        <section className="markdown-editor__source markdown-editor__source--mdx" aria-label="Markdown 编辑区">
          <MDXEditor
            key={editor.id ?? 'new'}
            className="genesis-mdx-editor"
            contentEditableClassName="genesis-mdx-content"
            markdown={editor.contentMarkdown}
            onChange={(contentMarkdown) => onChange({ ...editor, contentMarkdown })}
            plugins={[
              headingsPlugin(),
              listsPlugin(),
              quotePlugin(),
              thematicBreakPlugin(),
              linkPlugin(),
              linkDialogPlugin(),
              tablePlugin(),
              imagePlugin(),
              codeBlockPlugin({ defaultCodeBlockLanguage: 'text' }),
              codeMirrorPlugin({ codeBlockLanguages: { text: '纯文本', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', json: 'JSON', bash: 'Bash', css: 'CSS', html: 'HTML' } }),
              diffSourcePlugin({ viewMode: 'rich-text' }),
              markdownShortcutPlugin(),
              toolbarPlugin({ toolbarContents: () => <KitchenSinkToolbar /> }),
            ]}
            spellCheck={false}
          />
        </section>
      </div>
      {isSettingsOpen && <PostSettingsModal editor={editor} feedback={feedback} isSaving={isSaving} onChange={onChange} onClose={() => setIsSettingsOpen(false)} onDelete={onDelete} onImportMarkdown={importMarkdown} onSave={onSave} />}
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

function PostsIndex({
  posts,
  onCreatePost,
  onOpenPost,
}: {
  posts: BlogPostAdmin[]
  onCreatePost: () => void
  onOpenPost: (post: BlogPostAdmin) => void
}) {

  return (
    <section className="studio-post-index" aria-label="文章列表">
      <div className="studio-post-index__toolbar">
        <strong className="studio-post-index__toolbar-title">文章</strong>
        <label htmlFor="studio-post-search"><StudioIcon name="search" /><span className="sr-only">搜索文章</span><input id="studio-post-search" placeholder="输入关键词搜索" /></label>
        <div className="studio-post-index__filters" aria-label="文章筛选">
          <button className="is-active" type="button">状态：全部</button>
          <button type="button">可见性：全部</button>
          <button type="button">排序：最新</button>
        </div>
        <span className="studio-post-count">共 {posts.length} 篇</span>
        <div className="studio-post-index__actions">
          <button type="button">分类</button>
          <button type="button">标签</button>
          <button type="button">回收站</button>
          <button className="new-post-button" type="button" onClick={onCreatePost}><StudioIcon name="plus" /> 新建</button>
        </div>
      </div>
      <div className="studio-content-list">
        {posts.map((post) => (
          <button className="studio-content-list__item" key={post.id} type="button" onClick={() => onOpenPost(post)}>
            <span className="studio-post-check" aria-hidden="true" />
            <span className="studio-content-list__body">
              <strong>{post.title}</strong>
              <small>分类：内容 · 访问量：— · 评论：0</small>
              <em>{post.status === 'published' ? '已发布' : '草稿'}</em>
            </span>
            <span className="studio-content-list__meta"><span>{post.status === 'published' ? '公开' : '未发布'}</span><time>{post.updated_at.slice(0, 10)}</time><StudioIcon name="chevron" /></span>
          </button>
        ))}
        {posts.length === 0 && <p className="studio-context-empty">还没有文章，创建第一篇草稿吧。</p>}
      </div>
    </section>
  )
}

function ArticleReader({
  editor,
  onBack,
  onEdit,
}: {
  editor: EditorState
  onBack: () => void
  onEdit: () => void
}) {
  return (
    <section className="article-reader" aria-labelledby="article-reader-title">
      <header className="article-reader__header">
        <div className="article-reader__heading">
          <button className="text-button article-reader__back" type="button" onClick={onBack}>← 返回文章列表</button>
          <div className="article-reader__eyebrow">{editor.status === 'published' ? 'PUBLISHED ARTICLE' : 'DRAFT ARTICLE'}</div>
          <h1 id="article-reader-title">{editor.title || '未命名文章'}</h1>
          <p>{editor.excerpt || '还没有摘要，打开编辑设置补充文章信息。'}</p>
          <div className="article-reader__meta">
            <span>{editor.readTimeMinutes} 分钟阅读</span>
            {editor.tagsText && <span>{editor.tagsText}</span>}
            <span>{editor.isFeatured ? '精选文章' : '普通文章'}</span>
          </div>
        </div>
        <div className="article-reader__actions">
          <span className={`post-status post-status--${editor.status}`}>
            {editor.status === 'published' ? '已发布' : '草稿'}
          </span>
          <button className="primary-button" type="button" onClick={onEdit}>编辑文章</button>
        </div>
      </header>
      <article className="article-reader__content article-content">
        <Markdown remarkPlugins={[remarkGfm]}>{editor.contentMarkdown || '开始输入 Markdown 内容。'}</Markdown>
      </article>
    </section>
  )
}

function PostsWorkspace({
  editor,
  feedback,
  isEditorOpen,
  isSaving,
  posts,
  view,
  onChange,
  onCreatePost,
  onDelete,
  onEdit,
  onOpenPost,
  onPreview,
  onBack,
  onSave,
}: {
  editor: EditorState
  feedback: string | null
  isEditorOpen: boolean
  isSaving: boolean
  posts: BlogPostAdmin[]
  view: 'list' | 'preview'
  onChange: (editor: EditorState) => void
  onCreatePost: () => void
  onDelete: () => void
  onEdit: () => void
  onOpenPost: (post: BlogPostAdmin) => void
  onPreview: () => void
  onBack: () => void
  onSave: (status: BlogPostStatus) => void
}) {
  if (view === 'list') {
    return <PostsIndex onCreatePost={onCreatePost} onOpenPost={onOpenPost} posts={posts} />
  }

  if (isEditorOpen) {
    return <MarkdownEditor editor={editor} feedback={feedback} isSaving={isSaving} onBack={onBack} onChange={onChange} onDelete={onDelete} onPreview={onPreview} onSave={onSave} />
  }

  return <ArticleReader editor={editor} onBack={onBack} onEdit={onEdit} />
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

const studioSectionIds: StudioSection[] = ['overview', 'posts', 'pages', 'comments', 'attachments', 'links', 'themes', 'menus', 'users', 'settings']

function getStudioRoute(pathname: string): {
  activeSection: StudioSection
  postId: string | null
  postView: 'list' | 'preview'
  isEditorOpen: boolean
} {
  const relativePath = pathname.replace(/^\/blog\/studio\/?/, '')
  const [sectionSegment, postSegment, actionSegment] = relativePath.split('/').filter(Boolean)
  const activeSection = sectionSegment && studioSectionIds.includes(sectionSegment as StudioSection)
    ? sectionSegment as StudioSection
    : 'overview'
  const postId = activeSection === 'posts' && postSegment && postSegment !== 'new' ? postSegment : null
  const isEditorOpen = activeSection === 'posts' && (postSegment === 'new' || actionSegment === 'edit')
  const postView = activeSection === 'posts' && (postId !== null || isEditorOpen) ? 'preview' : 'list'
  return { activeSection, postId, postView, isEditorOpen }
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
  const location = useLocation()
  const navigate = useNavigate()
  const { activeSection, postId, postView, isEditorOpen } = getStudioRoute(location.pathname)
  const [editor, setEditor] = useState<EditorState>(() => createEmptyEditor())
  const [managedPosts, setManagedPosts] = useState(posts)
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const studioBasePath = '/blog/studio'

  const selectedPost = postId === null ? null : managedPosts.find((post) => post.id === postId) ?? null
  const activeEditor = selectedPost && editor.id !== postId ? toEditor(selectedPost) : editor

  function selectSection(section: StudioSection) {
    void navigate(section === 'overview' ? studioBasePath : `${studioBasePath}/${section}`)
  }

  function createPost() {
    setEditor(createEmptyEditor())
    setFeedback(null)
    void navigate(`${studioBasePath}/posts/new/edit`)
  }

  function openPost(post: BlogPostAdmin) {
    setEditor(toEditor(post))
    setFeedback(null)
    void navigate(`${studioBasePath}/posts/${encodeURIComponent(post.id)}/edit`)
  }

  async function savePost(status: BlogPostStatus) {
    let payload: BlogPostWrite
    try {
      payload = toPayload({ ...activeEditor, status })
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '文章信息不完整。')
      return
    }

    setIsSaving(true)
    setFeedback(null)
    try {
      const savedPost = activeEditor.id === null
        ? await createAdminBlogPost(token, payload)
        : await updateAdminBlogPost(token, activeEditor.id, payload)
      setManagedPosts((currentPosts) => [savedPost, ...currentPosts.filter((post) => post.id !== savedPost.id)])
      setEditor(toEditor(savedPost))
      setFeedback('已保存。')
      void navigate(`${studioBasePath}/posts/${encodeURIComponent(savedPost.id)}/edit`)
    } catch {
      setFeedback('保存失败，请检查必填项、Slug 和网络连接。')
    } finally {
      setIsSaving(false)
    }
  }

  async function deletePost() {
    if (activeEditor.id === null) return
    if (!window.confirm(`确定删除「${activeEditor.title}」吗？此操作不可恢复。`)) return
    try {
      await deleteAdminBlogPost(token, activeEditor.id)
      setManagedPosts((currentPosts) => currentPosts.filter((post) => post.id !== activeEditor.id))
      setEditor(createEmptyEditor())
      setFeedback('文章已删除。')
      void navigate(`${studioBasePath}/posts`)
    } catch {
      setFeedback('删除失败，请稍后重试。')
    }
  }

  const meta = sectionMeta[activeSection]

  return (
    <div className="studio-app-shell">
      <StudioNavigation activeSection={activeSection} onChange={selectSection} onLogout={onLogout} user={user} />

      <div className="studio-workspace">
        {!isEditorOpen && (
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
        )}

        <main className={activeSection === 'posts' ? 'studio-content studio-content--editor' : 'studio-content'}>
          {activeSection === 'overview' && (
            <StudioOverview posts={managedPosts} onChange={selectSection} onCreatePost={createPost} onOpenPost={openPost} />
          )}
          {activeSection === 'posts' && (
            <PostsWorkspace
              editor={activeEditor}
              feedback={feedback}
              isEditorOpen={isEditorOpen}
              isSaving={isSaving}
              onChange={setEditor}
              onCreatePost={createPost}
              onDelete={() => void deletePost()}
              onEdit={() => { void navigate(activeEditor.id ? `${studioBasePath}/posts/${encodeURIComponent(activeEditor.id)}/edit` : `${studioBasePath}/posts/new/edit`) }}
              onOpenPost={openPost}
              onPreview={() => { void navigate(activeEditor.id ? `${studioBasePath}/posts/${encodeURIComponent(activeEditor.id)}` : `${studioBasePath}/posts`) }}
              onBack={() => { void navigate(`${studioBasePath}/posts`) }}
              onSave={(status) => void savePost(status)}
              posts={managedPosts}
              view={postView}
            />
          )}
          {activeSection !== 'overview' && activeSection !== 'posts' && <SectionPlaceholder section={activeSection} />}
        </main>
      </div>
      <StudioAssistant
        activeSection={activeSection}
        editor={activeSection === 'posts' && postView === 'preview' ? { id: activeEditor.id, title: activeEditor.title, excerpt: activeEditor.excerpt, contentMarkdown: activeEditor.contentMarkdown, slug: activeEditor.slug } : null}
      />
    </div>
  )
}

export function Studio() {
  const [token, setToken] = useState<string | null>(() => getStoredAuthToken(studioAuthTokenKey))
  const [state, setState] = useState<StudioState>(() =>
    getStoredAuthToken(studioAuthTokenKey) === null ? { status: 'login', error: null } : { status: 'loading' },
  )

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
          clearStoredAuthToken(studioAuthTokenKey)
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
        storeAuthToken(data.access_token, studioAuthTokenKey)
        setToken(data.access_token)
      })
      .catch(() => setState({ status: 'login', error: '账号或密码错误。' }))
  }

  function handleLogout() {
    clearStoredAuthToken(studioAuthTokenKey)
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
