import { type FormEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useBlocker, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { pageTransition } from './lib/motion'
import { ArticleMarkdown } from './features/blog/ArticleMarkdown'
import { EditorView } from '@codemirror/view'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  codeBlockPlugin,
  codeMirrorPlugin,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  diffSourcePlugin,
  HighlightToggle,
  headingsPlugin,
  imagePlugin,
  InsertAdmonition,
  InsertCodeBlock,
  InsertFrontmatter,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  linkDialogPlugin,
  linkPlugin,
  ListsToggle,
  listsPlugin,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  Separator,
  StrikeThroughSupSubToggles,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
  type Translation,
  type MDXEditorMethods,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import './studio/styles/shell.css'
import './studio/styles/login.css'
import './studio/styles/editor.css'
import './studio/styles/editor-content.css'
import './studio/styles/editor-outline.css'
import './studio/styles/article-settings.css'
import './studio/styles/article-reader.css'
import './studio/styles/writing.css'


import { clearStoredAuthToken, getStoredAuthToken, storeAuthToken, studioAuthTokenKey } from './lib/auth'
import { StudioIcon } from './studio/StudioIcon'
import { StudioNavigation } from './studio/StudioNavigation'
import type { StudioSection } from './studio/StudioNavigationModel'
import { BlogAssistant } from './features/blog/agent/BlogAssistant'
import { StudioOverview } from './studio/StudioOverview'
import { PostsIndex } from './studio/PostsIndex'
import { TaxonomyWorkspace } from './studio/TaxonomyWorkspace'
import { LinksWorkspace } from './studio/LinksWorkspace'
import { CommentsWorkspace } from './studio/CommentsWorkspace'
import { TaxonomyPicker } from './studio/TaxonomyPicker'
import { createTaxonomy, type ArticleTaxonomyActions, type TaxonomyKind } from './studio/taxonomy'
import { useModalDialog } from './studio/useModalDialog'
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

const genesisCodeBlockTheme = EditorView.theme({
  '&': {
    backgroundColor: '#ffffff',
    color: '#000',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
    fontSize: '.88rem',
    lineHeight: '1.75',
  },
  '.cm-content': {
    minHeight: '5rem',
    padding: '.75rem 2rem .7rem 1.9rem',
    caretColor: '#2563eb',
  },
  '.cm-line': { padding: '0 .45rem' },
  '.cm-gutters': {
    border: '0',
    borderRight: '1px solid #e8edf4',
    backgroundColor: '#ffffff',
    color: '#000',
  },
  '.cm-gutterElement': {
    padding: '0 .9rem 0 1rem',
    fontSize: '.86rem',
    fontWeight: '500',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { color: '#000' },
  '.cm-selectionBackground': { backgroundColor: '#dbeafe !important' },
  '.cm-cursor': { borderLeftColor: '#2563eb' },
  '.cm-tooltip': {
    border: '1px solid #d8e1ee',
    borderRadius: '.4rem',
    backgroundColor: '#ffffff',
    color: '#000',
    boxShadow: '0 .6rem 1.5rem rgba(15, 23, 42, .12)',
  },
}, { dark: false })
const GenesisToolbar = () => (
  <DiffSourceToggleWrapper>
    <UndoRedo />
    <Separator />
    <BoldItalicUnderlineToggles />
    <CodeToggle />
    <HighlightToggle />
    <Separator />
    <StrikeThroughSupSubToggles />
    <Separator />
    <ListsToggle />
    <Separator />
    <BlockTypeSelect />
    <Separator />
    <CreateLink />
    <InsertImage />
    <Separator />
    <InsertTable />
    <InsertThematicBreak />
    <Separator />
    <InsertCodeBlock />
    <InsertAdmonition />
    <Separator />
    <InsertFrontmatter />
  </DiffSourceToggleWrapper>
)
type MarkdownOutlineItem = {
  level: number
  text: string
}

function getMarkdownOutline(markdown: string): MarkdownOutlineItem[] {
  const lines = markdown.split('\n')
  const headings: MarkdownOutlineItem[] = []
  let isInsideCodeFence = false

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      isInsideCodeFence = !isInsideCodeFence
      continue
    }
    if (isInsideCodeFence) continue

    const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) continue

    headings.push({
      level: (match[1] ?? '').length,
      text: (match[2] ?? '').replace(/[*_~]/g, '').trim(),
    })
  }

  return headings
}
const mdxEditorChineseText: Record<string, string> = {
  "admonitions.caution": "注意",
  "admonitions.changeType": "选择提示类型",
  "admonitions.danger": "警告",
  "admonitions.info": "信息",
  "admonitions.note": "说明",
  "admonitions.placeholder": "提示类型",
  "admonitions.tip": "提示",
  "codeBlock.inlineLanguage": "语言",
  "codeBlock.language": "代码块语言",
  "codeBlock.selectLanguage": "选择代码语言",
  "codeblock.delete": "删除代码块",
  "createLink.cancelTooltip": "取消修改",
  "createLink.saveTooltip": "设置链接",
  "createLink.text": "链接文字",
  "createLink.textTooltip": "链接显示的文字",
  "createLink.title": "链接标题",
  "createLink.titleTooltip": "鼠标悬停时显示的标题",
  "createLink.url": "链接地址",
  "createLink.urlPlaceholder": "选择或粘贴链接地址",
  "dialog.close": "关闭对话框",
  "dialogControls.cancel": "取消",
  "dialogControls.save": "保存",
  "frontmatterEditor.addEntry": "添加字段",
  "frontmatterEditor.key": "字段名",
  "frontmatterEditor.title": "编辑文档 Frontmatter",
  "frontmatterEditor.value": "字段值",
  "imageEditor.deleteImage": "删除图片",
  "imageEditor.editImage": "编辑图片",
  "linkPreview.copied": "已复制！",
  "linkPreview.copyToClipboard": "复制到剪贴板",
  "linkPreview.edit": "编辑链接",
  "linkPreview.remove": "移除链接",
  "table.alignCenter": "居中对齐",
  "table.alignLeft": "左对齐",
  "table.alignRight": "右对齐",
  "table.columnMenu": "列菜单",
  "table.deleteColumn": "删除此列",
  "table.deleteRow": "删除此行",
  "table.deleteTable": "删除表格",
  "table.insertColumnLeft": "在左侧插入列",
  "table.insertColumnRight": "在右侧插入列",
  "table.insertRowAbove": "在上方插入行",
  "table.insertRowBelow": "在下方插入行",
  "table.rowMenu": "行菜单",
  "table.textAlignment": "文本对齐",
  "toolbar.admonition": "插入提示块",
  "toolbar.blockTypeSelect.placeholder": "段落类型",
  "toolbar.blockTypeSelect.selectBlockTypeTooltip": "选择段落类型",
  "toolbar.blockTypes.heading": "标题 {{level}}",
  "toolbar.blockTypes.paragraph": "正文段落",
  "toolbar.blockTypes.quote": "引用",
  "toolbar.bold": "粗体",
  "toolbar.bulletedList": "无序列表",
  "toolbar.checkList": "任务列表",
  "toolbar.codeBlock": "插入代码块",
  "toolbar.diffMode": "差异对比",
  "toolbar.editFrontmatter": "编辑 Frontmatter",
  "toolbar.highlight": "高亮",
  "toolbar.image": "插入图片",
  "toolbar.inlineCode": "行内代码",
  "toolbar.insertFrontmatter": "插入 Frontmatter",
  "toolbar.italic": "斜体",
  "toolbar.link": "创建链接",
  "toolbar.numberedList": "有序列表",
  "toolbar.redo": "重做 {{shortcut}}",
  "toolbar.removeBold": "取消粗体",
  "toolbar.removeHighlight": "取消高亮",
  "toolbar.removeInlineCode": "取消行内代码",
  "toolbar.removeItalic": "取消斜体",
  "toolbar.removeStrikethrough": "取消删除线",
  "toolbar.removeSubscript": "取消下标",
  "toolbar.removeSuperscript": "取消上标",
  "toolbar.removeUnderline": "取消下划线",
  "toolbar.richText": "富文本",
  "toolbar.source": "源码模式",
  "toolbar.strikethrough": "删除线",
  "toolbar.subscript": "下标",
  "toolbar.superscript": "上标",
  "toolbar.table": "插入表格",
  "toolbar.thematicBreak": "插入分隔线",
  "toolbar.toggleGroup": "切换选项",
  "toolbar.underline": "下划线",
  "toolbar.undo": "撤销 {{shortcut}}",
  "uploadImage.addViaUrlInstructions": "或通过链接添加图片：",
  "uploadImage.addViaUrlInstructionsNoUpload": "通过链接添加图片：",
  "uploadImage.alt": "替代文本：",
  "uploadImage.autoCompletePlaceholder": "选择或粘贴图片链接",
  "uploadImage.dialogTitle": "上传图片",
  "uploadImage.height": "高度：",
  "uploadImage.title": "标题：",
  "uploadImage.uploadInstructions": "从设备上传图片：",
  "uploadImage.width": "宽度：",
}

const mdxEditorChineseTranslation: Translation = (key, defaultValue, interpolations) => {
  const template = mdxEditorChineseText[key] ?? defaultValue
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(interpolations?.[name] ?? ''))
}

type StudioState =
  | { status: 'login'; error: string | null }
  | { status: 'loading' }
  | { status: 'ready'; user: CurrentUser; posts: BlogPostAdmin[]; tags: BlogTag[]; categories: BlogCategory[] }
  | { status: 'error' }

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
          <p className="studio-login-security">受保护的作者入口 · 登录后可管理文章与草稿</p>
        </div>
      </section>
    </main>
  )
}

function PostSettingsModal({
  categories,
  editor,
  feedback,
  isSaving,
  onChange,
  onClose,
  onDelete,
  onSave,
  tags,
  onCreateTaxonomy,
  onSelectTaxonomy,
}: {
  categories: BlogCategory[]
  editor: EditorState
  feedback: string | null
  isSaving: boolean
  onChange: (editor: EditorState) => void
  onClose: () => void
  onDelete: () => void
  onSave: (status: BlogPostStatus) => void
  tags: BlogTag[]
} & ArticleTaxonomyActions) {
  const dialogRef = useModalDialog()

  return (
    <dialog ref={dialogRef} className="markdown-settings-modal" aria-labelledby="markdown-settings-title" onCancel={(event) => { event.preventDefault(); if (!isSaving) onClose() }} onClick={(event) => { if (!isSaving && event.target === event.currentTarget) onClose() }}>
      <section className="markdown-settings-modal__surface">
        <header className="markdown-settings-modal__header">
          <div>
            <p className="eyebrow">ARTICLE SETTINGS</p>
            <h2 id="markdown-settings-title">文章设置</h2>
          </div>
          <button className="markdown-settings-modal__close" disabled={isSaving} type="button" aria-label="关闭文章设置" onClick={onClose}><StudioIcon name="close" /></button>
        </header>
        <div className="markdown-settings-modal__body">
          <div className="settings-taxonomy-grid">
            <TaxonomyPicker kind="categories" items={categories} selected={editor.categoryId ? [editor.categoryId] : []} onSelect={(item) => onSelectTaxonomy('categories', item)} onCreate={(name) => onCreateTaxonomy('categories', name)} disabled={isSaving} />
            <TaxonomyPicker kind="tags" items={tags} selected={tags.filter((tag) => editor.selectedTagSlugs.includes(tag.slug)).map((tag) => tag.id)} onSelect={(item) => onSelectTaxonomy('tags', item)} onCreate={(name) => onCreateTaxonomy('tags', name)} disabled={isSaving} />
          </div>
          <div className="settings-fields-grid">
            <label className="settings-field" htmlFor="settings-slug">
              文章地址
              <input id="settings-slug" onChange={(event) => onChange({ ...editor, slug: event.currentTarget.value })} pattern="[a-z0-9]+(-[a-z0-9]+)*" required value={editor.slug} />
            </label>
            <label className="settings-field" htmlFor="settings-cover">
              <span className="settings-field__heading"><span>封面链接</span><span className="settings-field__hint">可选</span></span>
              <input id="settings-cover" onChange={(event) => onChange({ ...editor, coverImageUrl: event.currentTarget.value })} type="url" value={editor.coverImageUrl} />
            </label>
          </div>
          <label className="settings-field" htmlFor="settings-excerpt">
            <span className="settings-field__heading"><span>摘要</span><span className="settings-field__hint">留空时从正文生成</span></span>
            <textarea id="settings-excerpt" style={{ resize: 'none' }} onChange={(event) => onChange({ ...editor, excerpt: event.currentTarget.value })} maxLength={500} rows={3} value={editor.excerpt} />
          </label>
          {feedback && <p className="studio-form-error" role="alert">{feedback}</p>}
        </div>
        <footer className="markdown-settings-modal__footer">
          <button className="text-button text-button--danger" disabled={!editor.id || isSaving} type="button" onClick={() => { onClose(); onDelete() }}>删除文章</button>
          <div>
            {editor.status === 'draft' && <button className="secondary-button" disabled={isSaving} type="button" onClick={() => onSave('draft')}>保存草稿</button>}
            <button className="primary-button" disabled={isSaving} type="button" onClick={() => { onClose(); onSave('published') }}>{editor.status === 'published' ? '检查并更新发布' : '检查并发布'}</button>
          </div>
        </footer>
      </section>
    </dialog>
  )
}

function MarkdownEditor({
  categories,
  editor,
  feedback,
  isSaving,
  onBack,
  onChange,
  onDelete,
  onPreview,
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
  categories: BlogCategory[]
  editor: EditorState
  feedback: string | null
  isSaving: boolean
  onBack: () => void
  onChange: (editor: EditorState) => void
  onDelete: () => void
  onPreview: () => void
  onSave: (status: BlogPostStatus) => void
  tags: BlogTag[]
  saveState: string
  recovery: BlogDraft | null
  onRestoreDraft: () => void
  onDiscardDraft: () => void
  onCompareVersion: () => void
  hasVersionConflict: boolean
} & ArticleTaxonomyActions) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const editorWorkspaceRef = useRef<HTMLDivElement>(null)
  const markdownRef = useRef<MDXEditorMethods>(null)
  const outlineItems = getMarkdownOutline(editor.contentMarkdown)
  const [isOutlineExpanded, setIsOutlineExpanded] = useState(true)
  const stats = articleStats(editor.contentMarkdown)

  useEffect(() => {
    if (markdownRef.current?.getMarkdown() !== editor.contentMarkdown) markdownRef.current?.setMarkdown(editor.contentMarkdown)
  }, [editor.contentMarkdown])

  return (
    <section className="markdown-editor" aria-labelledby="markdown-editor-title">
      <header className="markdown-editor__header">
        <div className="markdown-editor__identity">
          <button className="text-button" type="button" onClick={onBack}>← 返回文章列表</button>
          <div className="markdown-editor__title-row">
            <span className="markdown-editor__eyebrow">文章写作</span>
            <span className={`post-status post-status--${editor.status}`}>{editor.status === 'published' ? '已发布' : '草稿'}</span>
            <span className="markdown-editor__save-state" role="status">{saveState}</span>
          </div>
          <input aria-label="文章标题" className="markdown-editor__title" id="markdown-editor-title" disabled={isSaving || recovery !== null} maxLength={200} onChange={(event) => onChange({ ...editor, title: event.currentTarget.value })} placeholder="输入文章标题" value={editor.title} />
        </div>
        <div className="markdown-editor__actions">
          <button className="secondary-button" disabled={isSaving || recovery !== null} type="button" onClick={onPreview}><StudioIcon name="eye" /> 预览</button>
          <button className="secondary-button" disabled={isSaving || recovery !== null} type="button" aria-label="打开文章设置" onClick={() => setIsSettingsOpen(true)}><StudioIcon name="settings" /> 设置</button>
          {editor.status === 'draft' && <button className="secondary-button" disabled={isSaving || recovery !== null} type="button" onClick={() => onSave('draft')}>保存草稿</button>}
          <button className="primary-button" disabled={isSaving || recovery !== null} type="button" onClick={() => onSave('published')}>{editor.status === 'published' ? '更新发布' : '发布'}</button>
        </div>
      </header>
      {feedback && <p className="markdown-editor__feedback" role="status">{feedback}</p>}
      {hasVersionConflict && <div className="markdown-editor__recovery"><span>站点上的文章已经更新，请先核对两个版本。</span><button type="button" disabled={isSaving} onClick={onCompareVersion}>核对站点版本</button></div>}
      {recovery && <div className="markdown-editor__recovery" role="status">
        <span>发现本标签页未保存的内容{recovery.editor.updatedAt !== editor.updatedAt ? '，站点版本可能已更新，请核对后保存' : ''}。</span>
        <button type="button" onClick={onRestoreDraft}>恢复内容</button>
        <button type="button" onClick={onDiscardDraft}>丢弃本地内容</button>
      </div>}
      <div className="markdown-editor__workspace markdown-editor__workspace--mdx" ref={editorWorkspaceRef}>
        <section className="markdown-editor__source markdown-editor__source--mdx" aria-label="Markdown 编辑区">
          <MDXEditor
            ref={markdownRef}
            key={editor.id ?? 'new'}
            className="genesis-mdx-editor"
            contentEditableClassName="genesis-mdx-content"
            markdown={editor.contentMarkdown}
            placeholder="写下你的想法，或打开博客助手一起构思。"
            readOnly={isSaving || recovery !== null}
            onChange={(contentMarkdown) => onChange({ ...editor, contentMarkdown })}
            translation={mdxEditorChineseTranslation}
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
              codeMirrorPlugin({ codeBlockLanguages: { text: '纯文本', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', json: 'JSON', bash: 'Bash', css: 'CSS', html: 'HTML' }, codeMirrorExtensions: [genesisCodeBlockTheme] }),
              diffSourcePlugin({ viewMode: 'rich-text' }),
              markdownShortcutPlugin(),
              toolbarPlugin({ toolbarContents: () => <GenesisToolbar /> }),
            ]}
            spellCheck={false}
          />
        </section>
        <aside className={`markdown-editor__outline markdown-editor__outline--mdx ${isOutlineExpanded ? 'markdown-editor__outline--expanded' : ''}`} aria-label="文章目录">
          <button
            aria-controls="markdown-editor-outline"
            aria-expanded={isOutlineExpanded}
            className="markdown-editor__outline-heading"
            type="button"
            onClick={() => setIsOutlineExpanded((isExpanded) => !isExpanded)}
          >
            <span>目录</span><small>{isOutlineExpanded ? `${outlineItems.length} 节 · 收起` : '展开'}</small>
          </button>
          {isOutlineExpanded && (outlineItems.length > 0 ? (
            <nav aria-label="文章标题导航" id="markdown-editor-outline">
              {outlineItems.map((item, index) => (
                <button
                  className={`markdown-editor__outline-item markdown-editor__outline-item--${item.level}`}
                  key={`${item.text}-${index}`}
                  type="button"
                  onClick={() => {
                    const headings = editorWorkspaceRef.current?.querySelectorAll('.genesis-mdx-content h1, .genesis-mdx-content h2, .genesis-mdx-content h3')
                    headings?.[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  {item.text}
                </button>
              ))}
            </nav>
          ) : <p className="markdown-editor__outline-empty" id="markdown-editor-outline">添加一级至三级标题后，会在这里显示目录。</p>)}
        </aside>
      </div>
      <footer className="markdown-editor__writing-meta"><span>{stats.count.toLocaleString('zh-CN')} 字 · 预计阅读 {stats.minutes} 分钟</span><span>未保存内容仅保留在本标签页</span></footer>
      {isSettingsOpen && <PostSettingsModal categories={categories} editor={editor} feedback={feedback} isSaving={isSaving} onChange={onChange} onClose={() => setIsSettingsOpen(false)} onDelete={onDelete} onSave={onSave} tags={tags} onCreateTaxonomy={onCreateTaxonomy} onSelectTaxonomy={onSelectTaxonomy} />}
    </section>
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
          {editor.selectedTagSlugs.length > 0 && <div className="article-reader__meta"><span>{editor.selectedTagSlugs.join(' · ')}</span></div>}
        </div>
        <div className="article-reader__actions">
          <span className={`post-status post-status--${editor.status}`}>
            {editor.status === 'published' ? '已发布' : '草稿'}
          </span>
          <button className="primary-button" type="button" onClick={onEdit}>编辑文章</button>
        </div>
      </header>
      <article className="article-reader__content article-content">
        <ArticleMarkdown>{editor.contentMarkdown || '开始输入 Markdown 内容。'}</ArticleMarkdown>
      </article>
    </section>
  )
}

function PostsWorkspace({
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
    return <MarkdownEditor categories={categories} editor={editor} feedback={feedback} isSaving={isSaving} onBack={onBack} onChange={onChange} onDelete={onDelete} onPreview={onPreview} onSave={onSave} tags={tags} onCreateTaxonomy={onCreateTaxonomy} onSelectTaxonomy={onSelectTaxonomy} saveState={saveState} recovery={recovery} onRestoreDraft={onRestoreDraft} onDiscardDraft={onDiscardDraft} onCompareVersion={onCompareVersion} hasVersionConflict={hasVersionConflict} />
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
    // 新视图挂载后再复位滚动，退出中的页面保持原位置完成淡出。
    if (!isPresent) return
    const content = containerRef.current?.querySelector<HTMLElement>('.studio-content')
    if (content) content.scrollTop = 0
    const editorWorkspace = containerRef.current?.querySelector<HTMLElement>('.markdown-editor__workspace--mdx')
    if (editorWorkspace) editorWorkspace.scrollTop = 0
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0
  }, [isPresent])

  return <motion.div ref={containerRef} className="studio-workspace" inert={!isPresent} initial={reducedMotion ? false : 'initial'} animate="enter" exit={reducedMotion ? undefined : 'exit'} variants={pageTransition}>
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
    if (bypassNavigation.current) return false
    if ((activeSection === 'links' || activeSection === 'comments') && (linkDirty || linkPending)) return nextLocation.pathname !== location.pathname
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
    if (!hasUnsavedChanges && !linkDirty && !linkPending) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges, linkDirty, linkPending])

  useEffect(() => {
    document.title = activeSection === 'posts' && resource !== null
      ? `${activeEditor.title || '新文章'} · ${isEditorOpen ? '写作' : '预览'} · Genesis`
      : `${sectionMeta[activeSection].title} · Genesis`
  }, [activeSection, activeEditor.title, isEditorOpen, resource])

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

  return (
    <div className="studio-app-shell">
      <StudioNavigation activeSection={activeSection} onChange={selectSection} onLogout={() => { if (hasUnsavedChanges || linkDirty || linkPending) setLogoutRequested(true); else onLogout() }} user={user} />

      <AnimatePresence initial={false} mode="wait">
      <StudioWorkspaceTransition key={location.pathname}>
        {!isEditorOpen && (
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

        <main className={activeSection === 'posts' ? 'studio-content studio-content--editor' : 'studio-content'}>
          {activeSection === 'overview' && (
            <StudioOverview posts={managedPosts} onChange={selectSection} onCreatePost={createPost} onOpenPost={openPost} />
          )}
          {activeSection === 'posts' && (
            <PostsWorkspace
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
          {activeSection === 'comments' && <CommentsWorkspace token={token} onPendingChange={setLinkPending} navigationBlocked={blocker.state === 'blocked' || logoutRequested} onCancelNavigation={() => { if (blocker.state === 'blocked') blocker.reset(); setLogoutRequested(false) }} onConfirmNavigation={() => { if (logoutRequested) onLogout(); else if (blocker.state === 'blocked') blocker.proceed(); setLogoutRequested(false) }} />}
          {activeSection !== 'overview' && activeSection !== 'posts' && activeSection !== 'categories' && activeSection !== 'tags' && activeSection !== 'links' && activeSection !== 'comments' && <SectionPlaceholder section={activeSection} />}
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
      {activeSection !== 'comments' && (blocker.state === 'blocked' || logoutRequested) && !(activeSection === 'links' && (linkDirty || linkPending)) && <BlogWorkflowDialog title={activeSection === 'links' ? '离开链接管理' : isSaving ? '正在保存文章' : '还有未保存的内容'} description={activeSection === 'links' ? '链接操作已完成，可以继续离开页面。' : isSaving ? '请等待保存完成，再离开写作页。' : localDraftSaved ? '内容已暂存在本标签页，返回文章时可以恢复。关闭标签页会清除暂存内容。' : '浏览器无法暂存当前内容，请取消并先保存文章。'} confirmLabel={activeSection === 'links' ? '继续离开' : '离开写作页'} busy={isSaving} onCancel={() => { if (blocker.state === 'blocked') blocker.reset(); setLogoutRequested(false) }} onConfirm={() => { if (logoutRequested) onLogout(); else if (blocker.state === 'blocked') blocker.proceed(); setLogoutRequested(false) }} />}
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
  const [token, setToken] = useState<string | null>(() => getStoredAuthToken(studioAuthTokenKey))
  const [state, setState] = useState<StudioState>(() =>
    getStoredAuthToken(studioAuthTokenKey) === null && !import.meta.env.DEV
      ? { status: 'login', error: null }
      : { status: 'loading' },
  )

  useEffect(() => {
    if (token === null) {
      if (!import.meta.env.DEV) return
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

    let cancelled = false
    void Promise.all([
      getCurrentUser(token),
      getAdminBlogPosts(token),
      getAdminBlogTags(token).catch(() => []),
      getAdminBlogCategories(token).catch(() => []),
    ])
      .then(([user, posts, tags, categories]) => {
        if (!cancelled) {
          setState({ status: 'ready', user, posts, tags, categories })
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
    return <Dashboard categories={state.categories} onLogout={handleLogout} posts={state.posts} tags={state.tags} token={token} user={state.user} />
  }

  if (state.status === 'login') {
    return <LoginForm error={state.error} onLogin={handleLogin} />
  }

  return <main className="studio-loading">页面状态异常，请刷新后重试。</main>
}
