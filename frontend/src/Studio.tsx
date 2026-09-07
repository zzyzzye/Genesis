import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  codeBlockPlugin,
  codeMirrorPlugin,
  CodeToggle,
  CreateLink,
  diffSourcePlugin,
  DiffSourceToggleWrapper,
  headingsPlugin,
  imagePlugin,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  Separator,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type Translation,
  UndoRedo,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'

import { clearStoredAuthToken, getStoredAuthToken, storeAuthToken, studioAuthTokenKey } from './lib/auth'
import { StudioIcon } from './studio/StudioIcon'
import { StudioNavigation } from './studio/StudioNavigation'
import type { StudioSection } from './studio/StudioNavigationModel'
import { StudioAssistant } from './studio/StudioAssistant'
import { StudioOverview } from './studio/StudioOverview'

import {
  createAdminBlogCategory,
  createAdminBlogPost,
  createAdminBlogTag,
  deleteAdminBlogPost,
  getAdminBlogCategories,
  getAdminBlogPosts,
  getAdminBlogTags,
  getCurrentUser,
  login,
  updateAdminBlogPost,
  type BlogCategory,
  type BlogCategoryWrite,
  type BlogPostAdmin,
  type BlogPostStatus,
  type BlogPostWrite,
  type BlogTag,
  type BlogTagWrite,
  type CurrentUser,
} from './lib/api'

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
  categoryId: string | null
  selectedTagSlugs: string[]
}

type StudioState =
  | { status: 'login'; error: string | null }
  | { status: 'loading' }
  | { status: 'ready'; user: CurrentUser; posts: BlogPostAdmin[]; tags: BlogTag[]; categories: BlogCategory[] }
  | { status: 'error' }

function createEmptyEditor(): EditorState {
  return {
    id: null,
    slug: '',
    title: '',
    excerpt: '',
    contentMarkdown: '从这里开始写。',
    coverImageUrl: '',
    status: 'draft',
    isFeatured: false,
    readTimeMinutes: 3,
    categoryId: null,
    selectedTagSlugs: [],
  }
}

function stripLeadingDocumentTitle(contentMarkdown: string, title: string): string {
  const match = /^(?:#\s+)(.+?)(?:\r?\n){1,2}/.exec(contentMarkdown)
  if (match?.[1]?.trim() === title.trim()) return contentMarkdown.slice(match[0].length)
  return contentMarkdown
}

function toEditor(post: BlogPostAdmin): EditorState {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    contentMarkdown: stripLeadingDocumentTitle(post.content_markdown, post.title),
    coverImageUrl: post.cover_image_url ?? '',
    status: post.status,
    isFeatured: post.is_featured,
    readTimeMinutes: post.read_time_minutes,
    categoryId: post.category?.id ?? null,
    selectedTagSlugs: post.tags.map((tag) => tag.slug),
  }
}

function toPayload(editor: EditorState, tagOptions: BlogTag[]): BlogPostWrite {
  const tagsBySlug = new Map(tagOptions.map((tag) => [tag.slug, tag]))
  const tags = editor.selectedTagSlugs.map((slug) => {
    const tag = tagsBySlug.get(slug)
    if (!tag) throw new Error(`标签“${slug}”不存在，请先创建后再选择。`)
    return { name: tag.name, slug: tag.slug }
  })
  return {
    slug: editor.slug.trim(),
    title: editor.title.trim(),
    excerpt: editor.excerpt.trim(),
    content_markdown: editor.contentMarkdown.trim(),
    cover_image_url: editor.coverImageUrl.trim() || null,
    category_id: editor.categoryId,
    status: editor.status,
    is_featured: editor.isFeatured,
    read_time_minutes: editor.readTimeMinutes,
    tags,
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
  categories,
  editor,
  feedback,
  isSaving,
  onChange,
  onClose,
  onCreateCategory,
  onCreateTag,
  onDelete,
  onImportMarkdown,
  onSave,
  tags,
}: {
  categories: BlogCategory[]
  editor: EditorState
  feedback: string | null
  isSaving: boolean
  onChange: (editor: EditorState) => void
  onClose: () => void
  onCreateCategory: (data: BlogCategoryWrite) => Promise<BlogCategory>
  onCreateTag: (data: BlogTagWrite) => Promise<BlogTag>
  onDelete: () => void
  onImportMarkdown: (file: File) => void
  onSave: (status: BlogPostStatus) => void
  tags: BlogTag[]
}) {
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategorySlug, setNewCategorySlug] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [newTagSlug, setNewTagSlug] = useState('')
  const [tagToAdd, setTagToAdd] = useState('')
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null)
  const selectedTags = tags.filter((tag) => editor.selectedTagSlugs.includes(tag.slug))
  const availableTags = tags.filter((tag) => !editor.selectedTagSlugs.includes(tag.slug))

  async function createCategory() {
    const name = newCategoryName.trim()
    const slug = newCategorySlug.trim()
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setTaxonomyError('请填写分类名称和英文 slug，例如：engineering。')
      return
    }
    try {
      const category = await onCreateCategory({ name, slug })
      onChange({ ...editor, categoryId: category.id })
      setNewCategoryName('')
      setNewCategorySlug('')
      setTaxonomyError(null)
    } catch (error) {
      setTaxonomyError(error instanceof Error ? error.message : '分类创建失败，请重试。')
    }
  }

  async function createTag() {
    const name = newTagName.trim()
    const slug = newTagSlug.trim()
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setTaxonomyError('请填写标签名称和英文 slug，例如：engineering。')
      return
    }
    if (selectedTags.length >= 10) {
      setTaxonomyError('一篇文章最多选择 10 个标签。')
      return
    }
    try {
      const tag = await onCreateTag({ name, slug })
      onChange({ ...editor, selectedTagSlugs: [...editor.selectedTagSlugs, tag.slug] })
      setNewTagName('')
      setNewTagSlug('')
      setTaxonomyError(null)
    } catch (error) {
      setTaxonomyError(error instanceof Error ? error.message : '标签创建失败，请重试。')
    }
  }

  function addTag() {
    if (!tagToAdd || editor.selectedTagSlugs.includes(tagToAdd) || selectedTags.length >= 10) return
    onChange({ ...editor, selectedTagSlugs: [...editor.selectedTagSlugs, tagToAdd] })
    setTagToAdd('')
  }

  return (
    <div className="markdown-settings-modal" role="dialog" aria-modal="true" aria-labelledby="markdown-settings-title">
      <section className="markdown-settings-modal__surface">
        <header className="markdown-settings-modal__header">
          <div>
            <p className="eyebrow">ARTICLE SETTINGS</p>
            <h2 id="markdown-settings-title">文章设置</h2>
            <span>整理文章信息、分类和标签</span>
          </div>
          <button className="markdown-settings-modal__close" type="button" aria-label="关闭文章设置" onClick={onClose}><StudioIcon name="close" /></button>
        </header>
        <div className="markdown-settings-modal__body">
          <section className="taxonomy-section" aria-labelledby="settings-category-title">
            <div className="taxonomy-section__heading"><div><h3 id="settings-category-title">分类</h3><p>先创建分类，再为文章选择一个归属。</p></div></div>
            <div className="taxonomy-select-row">
              <select aria-label="文章分类" value={editor.categoryId ?? ''} onChange={(event) => onChange({ ...editor, categoryId: event.currentTarget.value || null })}>
                <option value="">暂不分类</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
            <div className="taxonomy-create-row">
              <input aria-label="新分类名称" placeholder="新分类名称" value={newCategoryName} onChange={(event) => setNewCategoryName(event.currentTarget.value)} />
              <input aria-label="新分类 slug" placeholder="英文 slug" value={newCategorySlug} onChange={(event) => setNewCategorySlug(event.currentTarget.value)} />
              <button type="button" onClick={() => { void createCategory() }}>创建分类</button>
            </div>
          </section>
          <section className="taxonomy-section" aria-labelledby="settings-tags-title">
            <div className="taxonomy-section__heading"><div><h3 id="settings-tags-title">标签</h3><p>从已有标签中选择，也可以先创建新标签。</p></div><span>{selectedTags.length}/10</span></div>
            <div className="taxonomy-chips" aria-label="已选标签">
              {selectedTags.length === 0 && <span className="taxonomy-empty">暂未选择标签</span>}
              {selectedTags.map((tag) => <span className="taxonomy-chip" key={tag.id}>{tag.name}<button type="button" aria-label={`移除标签 ${tag.name}`} onClick={() => onChange({ ...editor, selectedTagSlugs: editor.selectedTagSlugs.filter((slug) => slug !== tag.slug) })}><StudioIcon name="close" /></button></span>)}
            </div>
            <div className="taxonomy-select-row">
              <select aria-label="选择已有标签" value={tagToAdd} onChange={(event) => setTagToAdd(event.currentTarget.value)}>
                <option value="">选择已有标签</option>
                {availableTags.map((tag) => <option key={tag.id} value={tag.slug}>{tag.name}</option>)}
              </select>
              <button type="button" disabled={!tagToAdd || selectedTags.length >= 10} onClick={addTag}>添加标签</button>
            </div>
            <div className="taxonomy-create-row">
              <input aria-label="新标签名称" placeholder="新标签名称" value={newTagName} onChange={(event) => setNewTagName(event.currentTarget.value)} />
              <input aria-label="新标签 slug" placeholder="英文 slug" value={newTagSlug} onChange={(event) => setNewTagSlug(event.currentTarget.value)} />
              <button type="button" onClick={() => { void createTag() }}>创建并选择</button>
            </div>
          </section>
          <label htmlFor="settings-slug">URL Slug<input id="settings-slug" onChange={(event) => onChange({ ...editor, slug: event.currentTarget.value })} pattern="[a-z0-9]+(-[a-z0-9]+)*" required value={editor.slug} /></label>
          <label htmlFor="settings-excerpt">摘要<textarea id="settings-excerpt" onChange={(event) => onChange({ ...editor, excerpt: event.currentTarget.value })} required rows={4} value={editor.excerpt} /></label>
          <label htmlFor="settings-cover">封面链接（可选）<input id="settings-cover" onChange={(event) => onChange({ ...editor, coverImageUrl: event.currentTarget.value })} type="url" value={editor.coverImageUrl} /></label>
          <div className="editor-options"><label htmlFor="settings-reading-time">阅读分钟<input id="settings-reading-time" min="1" onChange={(event) => onChange({ ...editor, readTimeMinutes: Number(event.currentTarget.value) || 1 })} type="number" value={editor.readTimeMinutes} /></label><label className="checkbox-label" htmlFor="settings-featured"><input checked={editor.isFeatured} id="settings-featured" onChange={(event) => onChange({ ...editor, isFeatured: event.currentTarget.checked })} type="checkbox" />设为精选</label></div>
          <label className="markdown-import-control"><span>导入 Markdown 文件</span><small>导入后会覆盖当前标题、摘要、Slug 和正文。</small><input accept=".md,text/markdown" type="file" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onImportMarkdown(file); event.currentTarget.value = '' }} /></label>
          {taxonomyError && <p className="studio-form-error" role="alert">{taxonomyError}</p>}
          {feedback && <p className="studio-form-error" role="alert">{feedback}</p>}
        </div>
        <footer className="markdown-settings-modal__footer"><button className="text-button text-button--danger" disabled={!editor.id || isSaving} type="button" onClick={onDelete}>删除文章</button><div><button className="secondary-button" disabled={isSaving} type="button" onClick={() => onSave('draft')}>保存草稿</button><button className="primary-button" disabled={isSaving} type="button" onClick={() => onSave('published')}>{isSaving ? '正在保存…' : '保存并发布'}</button></div></footer>
      </section>
    </div>
  )
}

function MarkdownEditor({
  categories,
  editor,
  feedback,
  isSaving,
  onBack,
  onChange,
  onCreateCategory,
  onCreateTag,
  onDelete,
  onPreview,
  onSave,
  tags,
}: {
  categories: BlogCategory[]
  editor: EditorState
  feedback: string | null
  isSaving: boolean
  onBack: () => void
  onChange: (editor: EditorState) => void
  onCreateCategory: (data: BlogCategoryWrite) => Promise<BlogCategory>
  onCreateTag: (data: BlogTagWrite) => Promise<BlogTag>
  onDelete: () => void
  onPreview: () => void
  onSave: (status: BlogPostStatus) => void
  tags: BlogTag[]
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
      onChange({ ...editor, id: null, title: metadata.title, excerpt: metadata.excerpt, slug: metadata.slug, contentMarkdown: stripLeadingDocumentTitle(content, metadata.title), status: 'draft' })
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
            <span className={`post-status post-status--${editor.status}`}>{editor.status === 'published' ? '已发布' : '草稿'}</span>
          </div>
          <input aria-label="文章标题" className="markdown-editor__title" id="markdown-editor-title" onChange={(event) => onChange({ ...editor, title: event.currentTarget.value })} placeholder="输入文章标题" value={editor.title} />
        </div>
        <div className="markdown-editor__actions">
          <button className="secondary-button" type="button" onClick={onPreview}><StudioIcon name="eye" /> 预览</button>
          <button className="secondary-button" type="button" aria-label="打开文章设置" onClick={() => setIsSettingsOpen(true)}><StudioIcon name="settings" /> 设置</button>
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
              codeMirrorPlugin({ codeBlockLanguages: { text: '纯文本', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', json: 'JSON', bash: 'Bash', css: 'CSS', html: 'HTML' } }),
              diffSourcePlugin({ viewMode: 'rich-text' }),
              markdownShortcutPlugin(),
              toolbarPlugin({
                toolbarContents: () => (
                  <DiffSourceToggleWrapper>
                    <UndoRedo />
                    <Separator />
                    <BoldItalicUnderlineToggles />
                    <CodeToggle />
                    <Separator />
                    <BlockTypeSelect />
                    <Separator />
                    <ListsToggle options={['bullet', 'number', 'check']} />
                    <Separator />
                    <CreateLink />
                    <InsertImage />
                    <InsertTable />
                    <InsertCodeBlock />
                    <InsertThematicBreak />
                  </DiffSourceToggleWrapper>
                ),
              }),
            ]}
            spellCheck={false}
          />
        </section>
      </div>
      {isSettingsOpen && <PostSettingsModal categories={categories} editor={editor} feedback={feedback} isSaving={isSaving} onChange={onChange} onClose={() => setIsSettingsOpen(false)} onCreateCategory={onCreateCategory} onCreateTag={onCreateTag} onDelete={onDelete} onImportMarkdown={importMarkdown} onSave={onSave} tags={tags} />}
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
          <button className="new-post-button" type="button" onClick={onCreatePost}><StudioIcon name="plus" /> 新建文章</button>
        </div>
      </div>
      <div className="studio-content-list">
        {posts.map((post) => (
          <button className="studio-content-list__item" key={post.id} type="button" onClick={() => onOpenPost(post)}>
            <span className="studio-post-check" aria-hidden="true" />
            <span className="studio-content-list__body">
              <strong>{post.title}</strong>
              <small>分类：{post.category?.name ?? '未分类'} · 访问量：— · 评论：0</small>
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
            {editor.selectedTagSlugs.length > 0 && <span>{editor.selectedTagSlugs.join(' · ')}</span>}
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
  categories,
  editor,
  feedback,
  isEditorOpen,
  isSaving,
  posts,
  view,
  onChange,
  onCreateCategory,
  onCreatePost,
  onDelete,
  onEdit,
  onOpenPost,
  onPreview,
  onCreateTag,
  onBack,
  onSave,
  tags,
}: {
  categories: BlogCategory[]
  editor: EditorState
  feedback: string | null
  isEditorOpen: boolean
  isSaving: boolean
  posts: BlogPostAdmin[]
  view: 'list' | 'preview'
  onChange: (editor: EditorState) => void
  onCreateCategory: (data: BlogCategoryWrite) => Promise<BlogCategory>
  onCreatePost: () => void
  onDelete: () => void
  onEdit: () => void
  onOpenPost: (post: BlogPostAdmin) => void
  onPreview: () => void
  onCreateTag: (data: BlogTagWrite) => Promise<BlogTag>
  onBack: () => void
  onSave: (status: BlogPostStatus) => void
  tags: BlogTag[]
}) {
  if (view === 'list') {
    return <PostsIndex onCreatePost={onCreatePost} onOpenPost={onOpenPost} posts={posts} />
  }

  if (isEditorOpen) {
    return <MarkdownEditor categories={categories} editor={editor} feedback={feedback} isSaving={isSaving} onBack={onBack} onChange={onChange} onCreateCategory={onCreateCategory} onCreateTag={onCreateTag} onDelete={onDelete} onPreview={onPreview} onSave={onSave} tags={tags} />
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
  const contentRef = useRef<HTMLElement>(null)
  const { activeSection, postId, postView, isEditorOpen } = getStudioRoute(location.pathname)
  const [editor, setEditor] = useState<EditorState>(() => createEmptyEditor())
  const [managedPosts, setManagedPosts] = useState(posts)
  const [tagOptions, setTagOptions] = useState(tags)
  const [categoryOptions, setCategoryOptions] = useState(categories)
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const studioBasePath = '/blog/studio'

  const selectedPost = postId === null ? null : managedPosts.find((post) => post.id === postId) ?? null
  const activeEditor = selectedPost && editor.id !== postId ? toEditor(selectedPost) : editor

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0
    const editorWorkspace = document.querySelector<HTMLElement>('.markdown-editor__workspace--mdx')
    if (editorWorkspace) editorWorkspace.scrollTop = 0
  }, [location.pathname])

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
      payload = toPayload({ ...activeEditor, status }, tagOptions)
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

  async function createTag(data: BlogTagWrite): Promise<BlogTag> {
    const created = await createAdminBlogTag(token, data)
    setTagOptions((current) => [...current.filter((tag) => tag.id !== created.id && tag.slug !== created.slug), created].sort((a, b) => a.name.localeCompare(b.name)))
    return created
  }

  async function createCategory(data: BlogCategoryWrite): Promise<BlogCategory> {
    const created = await createAdminBlogCategory(token, data)
    setCategoryOptions((current) => [...current.filter((category) => category.id !== created.id && category.slug !== created.slug), created].sort((a, b) => a.name.localeCompare(b.name)))
    return created
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

        <main ref={contentRef} className={activeSection === 'posts' ? 'studio-content studio-content--editor' : 'studio-content'}>
          {activeSection === 'overview' && (
            <StudioOverview posts={managedPosts} onChange={selectSection} onCreatePost={createPost} onOpenPost={openPost} />
          )}
          {activeSection === 'posts' && (
            <PostsWorkspace
              categories={categoryOptions}
              editor={activeEditor}
              feedback={feedback}
              isEditorOpen={isEditorOpen}
              isSaving={isSaving}
              onChange={setEditor}
              onCreateCategory={createCategory}
              onCreatePost={createPost}
              onDelete={() => void deletePost()}
              onEdit={() => { void navigate(activeEditor.id ? `${studioBasePath}/posts/${encodeURIComponent(activeEditor.id)}/edit` : `${studioBasePath}/posts/new/edit`) }}
              onOpenPost={openPost}
              onPreview={() => { void navigate(activeEditor.id ? `${studioBasePath}/posts/${encodeURIComponent(activeEditor.id)}` : `${studioBasePath}/posts`) }}
              onBack={() => { void navigate(`${studioBasePath}/posts`) }}
              onSave={(status) => void savePost(status)}
              posts={managedPosts}
              onCreateTag={createTag}
              tags={tagOptions}
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
