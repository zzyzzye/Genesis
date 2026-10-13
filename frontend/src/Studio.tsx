import { type FormEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useBlocker, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { studioWorkspaceTransition } from './lib/motion'
import './studio/styles/shell.css'
import './studio/styles/login.css'


import { authTokenChangedEvent, clearStoredAuthToken, getStoredAuthToken, storeAuthToken, studioAuthTokenKey, studioSessionExpiredEvent } from './lib/auth'
import { MarkdownEditor, ArticleReader } from './studio/MarkdownEditor'
import { StudioIcon } from './studio/StudioIcon'
import { StudioNavigation } from './studio/StudioNavigation'
import type { StudioSection } from './studio/StudioNavigationModel'
import { BlogAssistant } from './features/blog/agent/BlogAssistant'
import { StudioOverview } from './studio/StudioOverview'
import { PostsIndex } from './studio/PostsIndex'
import { TaxonomyWorkspace } from './studio/TaxonomyWorkspace'
import { LinksWorkspace } from './studio/LinksWorkspace'
import { AttachmentsWorkspace } from './studio/AttachmentsWorkspace'
import type { EditorAttachmentAccess } from './studio/EditorAttachmentPicker'
import { CommentsWorkspace } from './studio/CommentsWorkspace'
import { PagesWorkspace } from './studio/PagesWorkspace'
import { usePagesWorkspace } from './studio/usePagesWorkspace'
import { createTaxonomy, type ArticleTaxonomyActions, type TaxonomyKind } from './studio/taxonomy'
import { BlogWorkflowDialog } from './studio/BlogWorkflowDialog'
import { articleStats, clearBlogDraft, createEmptyEditor, readBlogDraft, toEditor, toPayload, writeBlogDraft, type BlogDraft, type EditorState } from './studio/blogEditor'

import {
  ApiError,
  createAdminBlogPost,
  deleteAdminBlogPost,
  getAdminBlogCategories,
  getAdminBlogPosts,
  getAdminBlogPost,
  getAdminBlogTags,
  getCurrentUser,
  developmentLogin,
  login,
  updateAdminBlogPost,
  type BlogCategory,
  type BlogPostAdmin,
  type BlogPostStatus,
  type BlogPostWrite,
  type BlogTag,
  type CurrentUser,
} from './lib/api'

type StudioState =
  | { status: 'login'; error: string | null }
  | { status: 'loading' }
  | { status: 'ready'; user: CurrentUser; posts: BlogPostAdmin[]; tags: BlogTag[]; categories: BlogCategory[] }
  | { status: 'error' }

function LoginForm({ onLogin, onDevelopmentLogin, error }: { onLogin: (handle: string, password: string) => void; onDevelopmentLogin?: () => void; error: string | null }) {
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
          <form noValidate onSubmit={submit}>
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
          {onDevelopmentLogin && <button className="studio-development-login" type="button" onClick={onDevelopmentLogin}>开发环境快捷登录</button>}
          <p className="studio-login-security">受保护的作者入口 · 登录后可管理文章与草稿</p>
        </div>
      </section>
    </main>
  )
}

const sectionMeta: Record<StudioSection, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: 'BLOG CONTROL CENTER', title: '仪表盘', description: '掌握内容状态并快速进入今天的工作。' },
  posts: { eyebrow: 'CONTENT / ARTICLES', title: '文章管理', description: '编辑、整理并发布长期内容。' },
  categories: { eyebrow: 'CONTENT / CATEGORIES', title: '分类管理', description: '整理文章主题，维护可复用的分类。' },
  tags: { eyebrow: 'CONTENT / TAGS', title: '标签管理', description: '管理文章关键词，方便内容关联与检索。' },
  pages: { eyebrow: 'CONTENT / PAGES', title: '页面管理', description: '规划站点里的固定页面和专题入口。' },
  comments: { eyebrow: 'CONTENT / COMMENTS', title: '评论管理', description: '查看读者反馈与讨论。' },
  attachments: { eyebrow: 'CONTENT / ASSETS', title: '附件管理', description: '统一整理图片、文件与媒体素材。' },
  links: { eyebrow: 'CONTENT / LINKS', title: '链接管理', description: '维护站点内外的重要连接。' },
  themes: { eyebrow: 'APPEARANCE / THEMES', title: '主题外观', description: '调整站点的视觉风格与展示方式。' },
  menus: { eyebrow: 'APPEARANCE / MENUS', title: '菜单管理', description: '组织访客使用的导航结构。' },
  users: { eyebrow: 'SYSTEM / USERS', title: '用户管理', description: '管理作者资料与访问权限。' },
  settings: { eyebrow: 'SYSTEM / SETTINGS', title: '系统设置', description: '配置博客系统的基础信息。' },
}


function PostsWorkspace({
  attachmentAccess,
  categories,
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
  tags,
  onCreateTaxonomy,
  onSelectTaxonomy,
  saveState,
  recovery,
  onRestoreDraft,
  onDiscardDraft,
  onCompareVersion,
  hasVersionConflict,
}: {
  attachmentAccess: EditorAttachmentAccess
  categories: BlogCategory[]
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
  tags: BlogTag[]
  saveState: string
  recovery: BlogDraft | null
  onRestoreDraft: () => void
  onDiscardDraft: () => void
  onCompareVersion: () => void
  hasVersionConflict: boolean
} & ArticleTaxonomyActions) {
  if (view === 'list') {
    return <PostsIndex onCreatePost={onCreatePost} onOpenPost={onOpenPost} posts={posts} />
  }

  if (isEditorOpen) {
    return <MarkdownEditor attachmentAccess={attachmentAccess} categories={categories} editor={editor} feedback={feedback} isSaving={isSaving} onBack={onBack} onChange={onChange} onDelete={onDelete} onPreview={onPreview} onSave={onSave} tags={tags} onCreateTaxonomy={onCreateTaxonomy} onSelectTaxonomy={onSelectTaxonomy} saveState={saveState} recovery={recovery} onRestoreDraft={onRestoreDraft} onDiscardDraft={onDiscardDraft} onCompareVersion={onCompareVersion} hasVersionConflict={hasVersionConflict} />
  }

  return <ArticleReader editor={editor} onBack={onBack} onEdit={onEdit} />
}

function SectionPlaceholder({ section }: { section: Exclude<StudioSection, 'overview' | 'posts'> }) {
  const meta = sectionMeta[section]
  return (
    <section className="studio-placeholder-panel" aria-label={`${meta.title}占位页`}>
      <span className="studio-placeholder-icon"><StudioIcon name="spark" /></span>
      <p>{meta.eyebrow}</p>
      <h2>{meta.title}</h2>
      <span>{meta.description}</span>
      <div className="studio-placeholder-rule" />
      <strong>{section === 'settings' ? '设置中心正在建设中。' : '这个功能模块正在建设中。'}</strong>
      <small>界面结构已经就位，业务能力将在对应阶段接入。</small>
    </section>
  )
}

const studioSectionIds: StudioSection[] = ['overview', 'posts', 'categories', 'tags', 'pages', 'comments', 'attachments', 'links', 'themes', 'menus', 'users', 'settings']

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
  const isEditorOpen = activeSection === 'posts' && actionSegment === 'edit'
  const postView = activeSection === 'posts' && (postId !== null || postSegment === 'new') ? 'preview' : 'list'
  return { activeSection, postId, postView, isEditorOpen }
}

function StudioWorkspaceTransition({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isPresent = useIsPresent()
  const reducedMotion = useReducedMotion()

  useLayoutEffect(() => {
    // 新视图挂载后再复位滚动，退出中的页面保留滚动位置完成退场。
    if (!isPresent) return
    const content = containerRef.current?.querySelector<HTMLElement>('.studio-content')
    if (content) content.scrollTop = 0
    const editorWorkspace = containerRef.current?.querySelector<HTMLElement>('.markdown-editor__workspace--mdx')
    if (editorWorkspace) editorWorkspace.scrollTop = 0
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0
  }, [isPresent])

  return <motion.div ref={containerRef} className="studio-workspace" inert={!isPresent} initial={reducedMotion ? false : 'initial'} animate="enter" exit={reducedMotion ? undefined : 'exit'} variants={studioWorkspaceTransition}>
    {children}
  </motion.div>
}

function Dashboard({
  posts,
  tags,
  categories,
  token,
  user,
  onLogout,
}: {
  posts: BlogPostAdmin[]
  tags: BlogTag[]
  categories: BlogCategory[]
  token: string
  user: CurrentUser
  onLogout: () => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { activeSection, postId, postView, isEditorOpen } = getStudioRoute(location.pathname)
  const pages = usePagesWorkspace(token, user.id)
  const [editor, setEditor] = useState<EditorState>(() => createEmptyEditor())
  const [managedPosts, setManagedPosts] = useState(posts)
  const [tagOptions, setTagOptions] = useState(tags)
  const [categoryOptions, setCategoryOptions] = useState(categories)
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [baseline, setBaseline] = useState(editor)
  const [recovery, setRecovery] = useState<BlogDraft | null>(null)
  const [localDraftSaved, setLocalDraftSaved] = useState(true)
  const [publication, setPublication] = useState<EditorState | null>(null)
  const [deleteRequested, setDeleteRequested] = useState(false)
  const [logoutRequested, setLogoutRequested] = useState(false)
  const [linkDirty, setLinkDirty] = useState(false)
  const [linkPending, setLinkPending] = useState(false)
  const [attachmentFormDirty, setAttachmentFormDirty] = useState(false)
  const [editorAttachmentOpen, setEditorAttachmentOpen] = useState(false)
  const [hasVersionConflict, setHasVersionConflict] = useState(false)
  const [comparison, setComparison] = useState<BlogPostAdmin | null>(null)
  const mutationLock = useRef(false)
  const bypassNavigation = useRef(false)
  const loadedResource = useRef<string | null>(null)
  const studioBasePath = '/blog/studio'

  const selectedPost = postId === null ? null : managedPosts.find((post) => post.id === postId) ?? null
  const activeEditor = selectedPost && editor.id !== postId ? toEditor(selectedPost) : editor
  const resource = postView === 'preview' ? postId ?? 'new' : null
  const hasUnsavedChanges = resource !== null && JSON.stringify(activeEditor) !== JSON.stringify(baseline)
  const blocker = useBlocker(({ nextLocation }) => {
    if (editorAttachmentOpen) return true
    if (pages.bypassNavigation.current) return false
    if (pages.active && (pages.dirty || pages.busy)) {
      if (pages.busy) return true
      const targetResource = nextLocation.pathname.startsWith('/blog/studio/pages/') ? nextLocation.pathname.slice('/blog/studio/pages/'.length).split('/')[0] : undefined
      return targetResource !== pages.resource
    }
    if (bypassNavigation.current) return false
    if (activeSection === 'attachments' && attachmentFormDirty) return nextLocation.pathname !== location.pathname || nextLocation.search !== location.search
    if ((activeSection === 'links' || activeSection === 'comments' || activeSection === 'attachments') && (linkDirty || linkPending)) return nextLocation.pathname !== location.pathname
    if (mutationLock.current) return true
    if (!hasUnsavedChanges) return false
    const target = getStudioRoute(nextLocation.pathname)
    return target.activeSection !== 'posts' || target.postView !== 'preview' || target.postId !== postId
  })

  useLayoutEffect(() => {
    bypassNavigation.current = false
    if (resource === null) { loadedResource.current = null; return }
    if (loadedResource.current === resource) return
    loadedResource.current = resource
    const initial = selectedPost ? toEditor(selectedPost) : createEmptyEditor()
    setEditor(initial)
    setBaseline(initial)
    const draft = readBlogDraft(user.id, postId)
    setRecovery(draft && JSON.stringify(draft.editor) !== JSON.stringify(initial) ? draft : null)
    setFeedback(null)
    setLocalDraftSaved(true)
    setHasVersionConflict(false)
    setComparison(null)
  }, [resource, postId, selectedPost, user.id])

  useEffect(() => {
    if (!hasUnsavedChanges && !linkDirty && !linkPending && !pages.dirty && !pages.busy && !editorAttachmentOpen) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges, linkDirty, linkPending, pages.dirty, pages.busy, editorAttachmentOpen])

  useEffect(() => {
    document.title = pages.active && pages.resource
      ? `${pages.ready ? pages.editor.title || '新页面' : pages.loadError ? '页面未能打开' : '正在打开页面'} · ${pages.editing ? '写作' : '预览'} · Genesis`
      : activeSection === 'posts' && resource !== null
      ? `${activeEditor.title || '新文章'} · ${isEditorOpen ? '写作' : '预览'} · Genesis`
      : `${sectionMeta[activeSection].title} · Genesis`
  }, [activeSection, activeEditor.title, isEditorOpen, resource, pages.active, pages.resource, pages.ready, pages.editor.title, pages.loadError, pages.editing])

  function changeEditor(next: EditorState) {
    if (mutationLock.current || recovery) return
    setEditor(next)
    setLocalDraftSaved(writeBlogDraft(user.id, next))
    setFeedback(null)
  }

  function selectSection(section: StudioSection) {
    void navigate(section === 'overview' ? studioBasePath : `${studioBasePath}/${section}`)
  }

  function createPost() {
    void navigate(`${studioBasePath}/posts/new/edit`)
  }

  function openPost(post: BlogPostAdmin) {
    void navigate(`${studioBasePath}/posts/${encodeURIComponent(post.id)}/edit`)
  }

  async function savePost(status: BlogPostStatus, source = activeEditor): Promise<boolean> {
    if (mutationLock.current) return false
    let payload: BlogPostWrite
    try {
      payload = toPayload(source, tagOptions, status)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '文章信息不完整。')
      return false
    }

    mutationLock.current = true
    setIsSaving(true)
    setFeedback(null)
    try {
      const savedPost = source.id === null
        ? await createAdminBlogPost(token, payload)
        : await updateAdminBlogPost(token, source.id, payload)
      setManagedPosts((currentPosts) => [savedPost, ...currentPosts.filter((post) => post.id !== savedPost.id)])
      setEditor(toEditor(savedPost))
      setBaseline(toEditor(savedPost))
      clearBlogDraft(user.id, source.id)
      setHasVersionConflict(false)
      loadedResource.current = savedPost.id
      bypassNavigation.current = true
      setFeedback(status === 'published' ? '已发布到站点。' : '草稿已保存到站点。')
      void navigate(`${studioBasePath}/posts/${encodeURIComponent(savedPost.id)}/edit`)
      return true
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '保存失败，输入已保留，请检查网络后重试。')
      if (error instanceof ApiError && error.status === 409 && source.id) {
        setHasVersionConflict(true)
        setPublication(null)
      }
      return false
    } finally {
      mutationLock.current = false
      setIsSaving(false)
    }
  }

  function requestSave(status: BlogPostStatus) {
    if (mutationLock.current || recovery) return
    if (status === 'draft') { void savePost(status); return }
    try {
      toPayload(activeEditor, tagOptions, 'published')
      setFeedback(null)
      setPublication({ ...activeEditor })
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '请先补充文章内容。')
      document.getElementById('markdown-editor-title')?.focus()
    }
  }

  async function compareVersion() {
    if (!activeEditor.id || mutationLock.current) return
    mutationLock.current = true
    setIsSaving(true)
    try { setComparison(await getAdminBlogPost(token, activeEditor.id)) }
    catch (error) { setFeedback(error instanceof Error ? error.message : '获取站点版本失败，请稍后重试。') }
    finally { mutationLock.current = false; setIsSaving(false) }
  }

  function reconcileVersion(keepLocal: boolean) {
    if (!comparison) return
    const latest = toEditor(comparison)
    const next = keepLocal ? { ...activeEditor, updatedAt: latest.updatedAt, status: latest.status } : latest
    setManagedPosts((current) => current.map((post) => post.id === comparison.id ? comparison : post))
    setBaseline(latest)
    setEditor(next)
    setLocalDraftSaved(keepLocal ? writeBlogDraft(user.id, next) : true)
    if (!keepLocal) clearBlogDraft(user.id, comparison.id)
    setHasVersionConflict(false)
    setComparison(null)
    setFeedback(keepLocal ? '已核对版本，当前修改尚未保存。' : '已采用站点版本。')
  }

  async function deletePost() {
    if (activeEditor.id === null || mutationLock.current) return
    mutationLock.current = true
    setIsSaving(true)
    setFeedback(null)
    try {
      await deleteAdminBlogPost(token, activeEditor.id)
      setManagedPosts((currentPosts) => currentPosts.filter((post) => post.id !== activeEditor.id))
      setEditor(createEmptyEditor())
      clearBlogDraft(user.id, activeEditor.id)
      setDeleteRequested(false)
      setFeedback('文章已删除。')
      bypassNavigation.current = true
      void navigate(`${studioBasePath}/posts`)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '删除失败，请稍后重试。')
    } finally {
      mutationLock.current = false
      setIsSaving(false)
    }
  }

  const meta = sectionMeta[activeSection]

  function taxonomyChanged(kind: 'categories' | 'tags', saved: BlogTag | null, previous: BlogTag | null) {
    const update = (items: BlogTag[]) => saved ? [...items.filter((item) => item.id !== saved.id), saved] : items.filter((item) => item.id !== previous?.id)
    if (kind === 'categories') {
      setCategoryOptions(update)
      if (previous && saved) setManagedPosts((current) => current.map((post) => post.category?.id === previous.id ? { ...post, category: saved } : post))
      if (previous && !saved) setEditor((current) => ({ ...current, categoryId: current.categoryId === previous.id ? null : current.categoryId }))
    } else {
      setTagOptions(update)
      if (previous && saved) {
        setManagedPosts((current) => current.map((post) => ({ ...post, tags: post.tags.map((tag) => tag.id === previous.id ? saved : tag) })))
        setEditor((current) => ({ ...current, selectedTagSlugs: current.selectedTagSlugs.map((slug) => slug === previous.slug ? saved.slug : slug) }))
      }
      if (previous && !saved) setEditor((current) => ({ ...current, selectedTagSlugs: current.selectedTagSlugs.filter((slug) => slug !== previous.slug) }))
    }
  }

  function selectArticleTaxonomy(kind: TaxonomyKind, item: BlogTag | null) {
    if (kind === 'categories') { changeEditor({ ...activeEditor, categoryId: item?.id ?? null }); return }
    if (!item) return
    const selected = activeEditor.selectedTagSlugs.includes(item.slug)
    if (!selected && activeEditor.selectedTagSlugs.length >= 10) return
    changeEditor({ ...activeEditor, selectedTagSlugs: selected ? activeEditor.selectedTagSlugs.filter((slug) => slug !== item.slug) : [...activeEditor.selectedTagSlugs, item.slug] })
  }

  async function createArticleTaxonomy(kind: TaxonomyKind, name: string): Promise<BlogTag> {
    const targetId = editor.id
    const items = kind === 'tags' ? tagOptions : categoryOptions
    const saved = items.find((item) => item.name === name.trim()) ?? await createTaxonomy(token, kind, name)
    taxonomyChanged(kind, saved, null)
    setEditor((current) => {
      if (current.id !== targetId || mutationLock.current) return current
      const next = kind === 'categories' ? { ...current, categoryId: saved.id } : { ...current, selectedTagSlugs: current.selectedTagSlugs.includes(saved.slug) ? current.selectedTagSlugs : [...current.selectedTagSlugs, saved.slug].slice(0, 10) }
      writeBlogDraft(user.id, next)
      return next
    })
    return saved
  }

  const attachmentAccess: EditorAttachmentAccess = { token, onOpenChange: setEditorAttachmentOpen, navigation: {
    blocked: blocker.state === 'blocked' || logoutRequested,
    onCancel: () => { if (blocker.state === 'blocked') blocker.reset(); setLogoutRequested(false) },
    onConfirm: () => { if (logoutRequested) onLogout(); else if (blocker.state === 'blocked') blocker.proceed(); setLogoutRequested(false) },
  } }

  return (
    <div className="studio-app-shell">
      <StudioNavigation activeSection={activeSection} onChange={selectSection} onLogout={() => { if (hasUnsavedChanges || linkDirty || linkPending || pages.dirty || pages.busy || editorAttachmentOpen) setLogoutRequested(true); else onLogout() }} user={user} />

      <AnimatePresence initial={false} mode="wait">
      <StudioWorkspaceTransition key={location.pathname}>
        {!isEditorOpen && !(pages.active && pages.editing) && (
          <header className="studio-topbar">
            <div className="studio-topbar__title">
              <span className="studio-mobile-level">内容工作区</span>
              <div><p>{meta.eyebrow}</p><h1>{meta.title}</h1><small>{meta.description}</small></div>
            </div>
            <div className="studio-topbar__actions">
              <Link className="studio-topbar__site-link" to="/blog"><StudioIcon name="eye" />查看站点 <StudioIcon name="arrow-up-right" /></Link>
            </div>
          </header>
        )}

        <main className={activeSection === 'posts' || activeSection === 'pages' ? 'studio-content studio-content--editor' : 'studio-content'}>
          {activeSection === 'overview' && (
            <StudioOverview posts={managedPosts} onChange={selectSection} onCreatePost={createPost} onOpenPost={openPost} />
          )}
          {activeSection === 'posts' && (
            <PostsWorkspace
              attachmentAccess={attachmentAccess}
              onCreateTaxonomy={createArticleTaxonomy}
              onSelectTaxonomy={selectArticleTaxonomy}
              categories={categoryOptions}
              editor={activeEditor}
              feedback={feedback}
              isEditorOpen={isEditorOpen}
              isSaving={isSaving}
              onChange={changeEditor}
              onCreatePost={createPost}
              onDelete={() => { setFeedback(null); setDeleteRequested(true) }}
              onEdit={() => { void navigate(activeEditor.id ? `${studioBasePath}/posts/${encodeURIComponent(activeEditor.id)}/edit` : `${studioBasePath}/posts/new/edit`) }}
              onOpenPost={openPost}
              onPreview={() => { void navigate(activeEditor.id ? `${studioBasePath}/posts/${encodeURIComponent(activeEditor.id)}` : `${studioBasePath}/posts/new`) }}
              onBack={() => { void navigate(`${studioBasePath}/posts`) }}
              onSave={requestSave}
              saveState={isSaving ? '正在保存…' : recovery ? '待恢复本地内容' : hasUnsavedChanges ? localDraftSaved ? '未保存 · 本标签页已暂存' : '未保存 · 无法暂存，请及时保存' : activeEditor.id ? '已保存到站点' : '尚未保存'}
              recovery={recovery}
              onRestoreDraft={() => { if (recovery) { setEditor(recovery.editor); setRecovery(null); setLocalDraftSaved(writeBlogDraft(user.id, recovery.editor)) } }}
              onDiscardDraft={() => { clearBlogDraft(user.id, postId); setRecovery(null) }}
              hasVersionConflict={hasVersionConflict}
              onCompareVersion={() => { void compareVersion() }}
              posts={managedPosts}
              tags={tagOptions}
              view={postView}
            />
          )}
          {(activeSection === 'categories' || activeSection === 'tags') && <TaxonomyWorkspace
            key={activeSection}
            kind={activeSection}
            token={token}
            items={activeSection === 'categories' ? categoryOptions : tagOptions}
            usage={Object.fromEntries((activeSection === 'categories' ? categoryOptions : tagOptions).map((item) => [item.id, managedPosts.filter((post) => activeSection === 'categories' ? post.category?.id === item.id : post.tags.some((tag) => tag.id === item.id)).length]))}
            onChanged={(saved, previous) => taxonomyChanged(activeSection, saved, previous)}
          />}
          {activeSection === 'links' && <LinksWorkspace token={token} onDirtyChange={setLinkDirty} onPendingChange={setLinkPending} navigationBlocked={blocker.state === 'blocked' || logoutRequested} onCancelNavigation={() => { if (blocker.state === 'blocked') blocker.reset(); setLogoutRequested(false) }} onConfirmNavigation={() => { if (logoutRequested) onLogout(); else if (blocker.state === 'blocked') blocker.proceed(); setLogoutRequested(false) }} />}
          {activeSection === 'attachments' && <AttachmentsWorkspace token={token} onFormChange={setAttachmentFormDirty} onDirtyChange={setLinkDirty} onPendingChange={setLinkPending} navigationBlocked={blocker.state === 'blocked' || logoutRequested} onCancelNavigation={() => { if (blocker.state === 'blocked') blocker.reset(); setLogoutRequested(false) }} onConfirmNavigation={() => { if (logoutRequested) onLogout(); else if (blocker.state === 'blocked') blocker.proceed(); setLogoutRequested(false) }} />}
          {activeSection === 'comments' && <CommentsWorkspace token={token} onPendingChange={setLinkPending} navigationBlocked={blocker.state === 'blocked' || logoutRequested} onCancelNavigation={() => { if (blocker.state === 'blocked') blocker.reset(); setLogoutRequested(false) }} onConfirmNavigation={() => { if (logoutRequested) onLogout(); else if (blocker.state === 'blocked') blocker.proceed(); setLogoutRequested(false) }} />}
          {activeSection === 'pages' && <PagesWorkspace attachmentAccess={attachmentAccess} attachmentOpen={editorAttachmentOpen} token={token} controller={pages} navigationBlocked={blocker.state === 'blocked' || logoutRequested} onCancelNavigation={() => { if (blocker.state === 'blocked') blocker.reset(); setLogoutRequested(false) }} onConfirmNavigation={() => { if (logoutRequested) onLogout(); else if (blocker.state === 'blocked') blocker.proceed(); setLogoutRequested(false) }} />}
          {activeSection !== 'overview' && activeSection !== 'posts' && activeSection !== 'categories' && activeSection !== 'tags' && activeSection !== 'links' && activeSection !== 'comments' && activeSection !== 'pages' && activeSection !== 'attachments' && <SectionPlaceholder section={activeSection} />}
        </main>
      </StudioWorkspaceTransition>
      </AnimatePresence>
      {publication && <BlogWorkflowDialog title={publication.status === 'published' ? '更新已发布文章' : '发布前检查'} description={publication.status === 'published' ? '确认后，站点上的文章将更新为当前内容。' : '确认后，这篇文章将公开显示在博客中。'} confirmLabel={publication.status === 'published' ? '确认更新发布' : '确认发布'} busy={isSaving} error={feedback} onCancel={() => setPublication(null)} onConfirm={() => { void savePost('published', publication).then((saved) => { if (saved) setPublication(null) }) }}>
        <dl>
          <div><dt>标题</dt><dd>{publication.title}</dd></div>
          <div><dt>地址</dt><dd>/articles/{publication.slug}</dd></div>
          <div><dt>摘要</dt><dd>{toPayload(publication, tagOptions, 'published').excerpt}</dd></div>
          <div><dt>分类</dt><dd>{categoryOptions.find((item) => item.id === publication.categoryId)?.name ?? '未分类'}</dd></div>
          <div><dt>标签</dt><dd>{tagOptions.filter((tag) => publication.selectedTagSlugs.includes(tag.slug)).map((tag) => tag.name).join('、') || '未设置'}</dd></div>
          <div><dt>正文</dt><dd>{articleStats(publication.contentMarkdown).count} 字 · 预计阅读 {articleStats(publication.contentMarkdown).minutes} 分钟</dd></div>
        </dl>
      </BlogWorkflowDialog>}
      {deleteRequested && <BlogWorkflowDialog title="删除文章" description={`删除「${activeEditor.title || '未命名文章'}」后，文章及本标签页的暂存内容均无法恢复。`} confirmLabel="删除文章" busy={isSaving} error={feedback} onCancel={() => setDeleteRequested(false)} onConfirm={() => { void deletePost() }} />}
      {comparison && <BlogWorkflowDialog title="核对文章版本" description="保留当前内容后，下次保存会替换下面展示的站点版本；也可以采用站点版本并丢弃当前修改。" confirmLabel="保留当前内容继续编辑" onCancel={() => setComparison(null)} onConfirm={() => reconcileVersion(true)}>
        <div className="blog-version-comparison">
          <details open><summary>当前输入：{activeEditor.title || '未命名文章'}</summary><pre>{activeEditor.contentMarkdown || '正文为空'}</pre></details>
          <details open><summary>站点版本：{comparison.title || '未命名文章'}</summary><pre>{comparison.content_markdown || '正文为空'}</pre></details>
          <button type="button" onClick={() => reconcileVersion(false)}>采用站点版本，丢弃当前修改</button>
        </div>
      </BlogWorkflowDialog>}
      {!editorAttachmentOpen && activeSection !== 'pages' && activeSection !== 'comments' && activeSection !== 'attachments' && (blocker.state === 'blocked' || logoutRequested) && !(activeSection === 'links' && (linkDirty || linkPending)) && <BlogWorkflowDialog title={activeSection === 'links' ? '离开链接管理' : isSaving ? '正在保存文章' : '还有未保存的内容'} description={activeSection === 'links' ? '链接操作已完成，可以继续离开页面。' : isSaving ? '请等待保存完成，再离开写作页。' : localDraftSaved ? '内容已暂存在本标签页，返回文章时可以恢复。关闭标签页会清除暂存内容。' : '浏览器无法暂存当前内容，请取消并先保存文章。'} confirmLabel={activeSection === 'links' ? '继续离开' : '离开写作页'} busy={isSaving} onCancel={() => { if (blocker.state === 'blocked') blocker.reset(); setLogoutRequested(false) }} onConfirm={() => { if (logoutRequested) onLogout(); else if (blocker.state === 'blocked') blocker.proceed(); setLogoutRequested(false) }} />}
      <BlogAssistant
        userId={user.id}
        onExecuted={() => {
          void getAdminBlogPosts(token).then(setManagedPosts).catch(() => {
            setFeedback('操作已执行，但文章列表刷新失败，请刷新页面查看。')
          })
        }}
        page={{
          route: location.pathname,
          section: activeSection,
          pageType: activeSection === 'overview'
            ? 'overview'
            : activeSection !== 'posts'
              ? 'section'
              : isEditorOpen
            ? 'post_editor'
            : postId !== null
              ? 'post_preview'
              : 'posts_list',
        }}
        editor={activeSection === 'posts' && (isEditorOpen || postId !== null) ? {
          id: activeEditor.id,
          title: activeEditor.title,
          excerpt: activeEditor.excerpt,
          contentMarkdown: activeEditor.contentMarkdown,
          slug: activeEditor.slug,
          status: activeEditor.status,
        } : null}
      />
    </div>
  )
}

export function Studio() {
  const sessionExpired = useRef(false)
  const [token, setToken] = useState<string | null>(() => getStoredAuthToken(studioAuthTokenKey))
  const [state, setState] = useState<StudioState>(() =>
    getStoredAuthToken(studioAuthTokenKey) === null && !import.meta.env.DEV
      ? { status: 'login', error: null }
      : { status: 'loading' },
  )

  useEffect(() => {
    function expireSession(event: Event) {
      sessionExpired.current = true
      if (event.defaultPrevented) return
      setToken(null)
      setState({ status: 'login', error: '登录已过期，请重新登录。文章草稿可在本标签页恢复，未完成的上传需要重新选择文件。' })
    }
    function syncSession() {
      const current = getStoredAuthToken(studioAuthTokenKey)
      if (current && current !== token) { sessionExpired.current = false; setToken(current) }
    }
    syncSession()
    window.addEventListener(authTokenChangedEvent, syncSession)
    window.addEventListener(studioSessionExpiredEvent, expireSession)
    return () => { window.removeEventListener(studioSessionExpiredEvent, expireSession); window.removeEventListener(authTokenChangedEvent, syncSession) }
  }, [token])

  useEffect(() => {
    if (state.status === 'login') document.title = '作者登录 · Genesis'
  }, [state.status])

  useEffect(() => {
    if (token === null) {
      if (!import.meta.env.DEV || sessionExpired.current) return
      let cancelled = false
      void developmentLogin()
        .then((data) => {
          if (cancelled) return
          storeAuthToken(data.access_token, studioAuthTokenKey)
          setToken(data.access_token)
        })
        .catch(() => {
          if (!cancelled) setState({ status: 'login', error: '开发环境自动登录失败，请手动登录。' })
        })
      return () => { cancelled = true }
    }

    if (getStoredAuthToken(studioAuthTokenKey) !== token) return
    let cancelled = false
    void Promise.all([
      getCurrentUser(token),
      getAdminBlogPosts(token),
      getAdminBlogTags(token).catch(() => []),
      getAdminBlogCategories(token).catch(() => []),
    ])
      .then(([user, posts, tags, categories]) => {
        if (!cancelled && !sessionExpired.current) {
          setState({ status: 'ready', user, posts, tags, categories })
        }
      })
      .catch((reason) => {
        if (!cancelled && getStoredAuthToken(studioAuthTokenKey) === token) {
          if (!(reason instanceof ApiError) || (reason.status !== 401 && reason.status !== 403)) {
            setState({ status: 'error' })
            return
          }
          sessionExpired.current = true
          clearStoredAuthToken(studioAuthTokenKey)
          setToken(null)
          setState({ status: 'login', error: reason.status === 403 ? '当前账户没有作者权限，请使用作者账号登录。' : '登录已过期，请重新登录。' })
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
        sessionExpired.current = false
        storeAuthToken(data.access_token, studioAuthTokenKey)
        setToken(data.access_token)
      })
      .catch(() => setState({ status: 'login', error: '账号或密码错误。' }))
  }

  function handleDevelopmentLogin() {
    setState({ status: 'loading' })
    void developmentLogin().then(data => {
      sessionExpired.current = false
      storeAuthToken(data.access_token, studioAuthTokenKey)
      setToken(data.access_token)
    }).catch(() => setState({ status: 'login', error: '开发环境快捷登录失败，请重试或手动登录。' }))
  }

  function handleLogout() {
    sessionExpired.current = true
    clearStoredAuthToken(studioAuthTokenKey)
    setToken(null)
    setState({ status: 'login', error: null })
  }

  if (state.status === 'loading') {
    return <main className="studio-loading">正在进入写作台…</main>
  }

  if (state.status === 'ready' && token !== null) {
    return <Dashboard categories={state.categories} onLogout={handleLogout} posts={state.posts} tags={state.tags} token={token} user={state.user} />
  }

  if (state.status === 'login') {
    return <LoginForm error={state.error} onLogin={handleLogin} onDevelopmentLogin={import.meta.env.DEV ? handleDevelopmentLogin : undefined} />
  }

  return <main className="studio-loading">工作台暂时无法加载，请刷新后重试。</main>
}
