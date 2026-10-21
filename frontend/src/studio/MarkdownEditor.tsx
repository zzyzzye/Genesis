import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { ArticleDocument, ArticleToc } from '../features/blog/ArticleToc'
import { FpsStatusSlot } from '../features/performance/FpsMonitor'
import { getArticleHeadings, type ArticleHeading } from '../features/blog/articleOutline'
import { EditorView } from '@codemirror/view'
import { Compartment, EditorState as CodeMirrorState, Transaction } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { basicSetup } from 'codemirror'
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
import './styles/editor.css'
import './styles/editor-content.css'
import './styles/editor-outline.css'
import './styles/article-settings.css'
import './styles/article-reader.css'
import './styles/writing.css'
import type { BlogCategory, BlogTag, BlogPostStatus } from '../lib/api'
import { StudioIcon } from './StudioIcon'
import { TaxonomyPicker } from './TaxonomyPicker'
import type { ArticleTaxonomyActions } from './taxonomy'
import { useModalDialog } from './useModalDialog'
import { articleStats, type BlogDraft, type EditorState } from './blogEditor'
import { attachmentMarkdown, type Attachment } from '../lib/attachments'
import { EditorAttachmentPicker, type EditorAttachmentAccess } from './EditorAttachmentPicker'
import { requiresMarkdownSource } from './markdownCompatibility'

const genesisCodeBlockTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--studio-soft)',
    color: 'var(--studio-ink)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
    fontSize: '.88rem',
    lineHeight: '1.75',
  },
  '.cm-content': {
    minHeight: '2.3rem',
    padding: '.4rem .75rem .35rem 0',
    caretColor: 'var(--studio-ink)',
  },
  '.cm-line': { padding: '0 4px' },
  '.cm-gutters': {
    border: '0',
    backgroundColor: 'var(--studio-soft)',
    color: 'var(--studio-editor-muted)',
  },
  '.cm-gutterElement': {
    padding: '0',
    fontSize: '.86rem',
    fontWeight: '500',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 4px 0 12px' },
  '.cm-foldGutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 2px',
  },
  // 固定图标尺寸并按行高居中，避免文字箭头的字体基线造成偏移。
  '.cm-foldGutter .cm-gutterElement span': {
    display: 'block',
    width: '10px',
    height: '10px',
    fontSize: '0',
    backgroundColor: 'currentColor',
    mask: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 12 12%27%3E%3Cpath d=%27m4 2 4 4-4 4%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.4%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E") center / contain no-repeat',
  },
  '.cm-foldGutter span[title="Fold line"]': { transform: 'rotate(90deg)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { color: 'var(--studio-editor-muted)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--studio-editor-hover) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--studio-ink)' },
  '.cm-tooltip': {
    border: '1px solid #d8e1ee',
    borderRadius: '.4rem',
    backgroundColor: '#ffffff',
    color: '#000',
    boxShadow: '0 .6rem 1.5rem rgba(15, 23, 42, .12)',
  },
}, { dark: false })

function MarkdownSourceEditor({ content, readOnly, onChange }: { content: string; readOnly: boolean; onChange: (content: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [initial] = useState(content)
  const [editable] = useState(() => new Compartment())
  const notifyChange = useEffectEvent(onChange)
  useEffect(() => {
    if (!host.current) return
    const instance = new EditorView({ parent: host.current, doc: initial, extensions: [
      genesisCodeBlockTheme, basicSetup, markdown(), EditorView.lineWrapping,
      editable.of([CodeMirrorState.readOnly.of(false), EditorView.editable.of(true)]),
      EditorView.contentAttributes.of({ 'aria-label': 'Markdown 源码' }),
      EditorView.updateListener.of(update => { if (update.docChanged) notifyChange(update.state.doc.toString()) }),
    ] })
    view.current = instance
    return () => { view.current = null; instance.destroy() }
  }, [initial, editable])
  useEffect(() => {
    const instance = view.current
    if (instance && instance.state.doc.toString() !== content) instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: content }, annotations: Transaction.addToHistory.of(false) })
  }, [content])
  useEffect(() => { view.current?.dispatch({ effects: editable.reconfigure([CodeMirrorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) }) }, [editable, readOnly])
  return <div className="mdxeditor-source-editor genesis-source-editor" ref={host} />
}
const GenesisToolbar = ({ onAttachment, disabled, sourceOnly = false }: { onAttachment?: () => void; disabled: boolean; sourceOnly?: boolean }) => {
  if (sourceOnly) return <div className="editor-tools-primary"><span>Markdown 源码</span>{onAttachment && <button type="button" className="editor-attachment-trigger" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onAttachment}><StudioIcon name="attachment" />插入附件</button>}</div>
  return (
  <DiffSourceToggleWrapper SourceToolbar={<>{onAttachment && <button type="button" className="editor-attachment-trigger" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onAttachment}><StudioIcon name="attachment" />插入附件</button>}</>}>
    <div className="editor-tools-primary">
      <UndoRedo />
      <BlockTypeSelect />
      <BoldItalicUnderlineToggles />
      <ListsToggle />
      <CreateLink />
    </div>
    <div className="editor-tools-secondary">
      <span className="editor-tools-label">格式</span>
      <CodeToggle /><HighlightToggle /><StrikeThroughSupSubToggles />
      <Separator />
      <span className="editor-tools-label">插入</span>
      <InsertImage />
      {onAttachment && <button type="button" className="editor-attachment-trigger" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onAttachment}><StudioIcon name="attachment" />插入附件</button>}
      <InsertTable /><InsertThematicBreak /><InsertCodeBlock /><InsertAdmonition /><InsertFrontmatter />
    </div>
  </DiffSourceToggleWrapper>
  )
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

function PostSettingsModal({
  kind = 'post',
  onUnpublish,
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
  kind?: 'post' | 'page'
  onUnpublish?: () => void
  categories: BlogCategory[]
  editor: EditorState
  feedback: string | null
  isSaving: boolean
  onChange: (editor: EditorState) => void
  onClose: () => void
  onDelete: () => void
  onSave: (status: BlogPostStatus) => void
  tags: BlogTag[]
} & Partial<ArticleTaxonomyActions>) {
  const dialogRef = useModalDialog()
  const label = kind === 'page' ? '页面' : '文章'

  return (
    <dialog ref={dialogRef} className="markdown-settings-modal" aria-labelledby="markdown-settings-title" onCancel={(event) => { event.preventDefault(); if (!isSaving) onClose() }} onClick={(event) => { if (!isSaving && event.target === event.currentTarget) onClose() }}>
      <section className="markdown-settings-modal__surface">
        <header className="markdown-settings-modal__header">
          <div>
            <h2 id="markdown-settings-title">{label}设置</h2>
          </div>
          <button className="markdown-settings-modal__close" disabled={isSaving} type="button" aria-label={`关闭${label}设置`} onClick={onClose}><StudioIcon name="close" /></button>
        </header>
        <div className="markdown-settings-modal__body">
          {kind === 'post' && onSelectTaxonomy && onCreateTaxonomy && <div className="settings-taxonomy-grid">
            <TaxonomyPicker kind="categories" items={categories} selected={editor.categoryIds ?? (editor.categoryId ? [editor.categoryId] : [])} onSelect={(item) => onSelectTaxonomy('categories', item)} onCreate={(name) => onCreateTaxonomy('categories', name)} disabled={isSaving} />
            <TaxonomyPicker kind="tags" items={tags} selected={tags.filter((tag) => editor.selectedTagSlugs.includes(tag.slug)).map((tag) => tag.id)} onSelect={(item) => onSelectTaxonomy('tags', item)} onCreate={(name) => onCreateTaxonomy('tags', name)} disabled={isSaving} />
          </div>}
          <div className="settings-fields-grid">
            <label className="settings-field" htmlFor="settings-slug">
              {label}地址
              <input id="settings-slug" aria-label={`${label}地址`} onChange={(event) => onChange({ ...editor, slug: event.currentTarget.value })} maxLength={160} aria-describedby="settings-slug-help" pattern="[a-z0-9]+(-[a-z0-9]+)*" required value={editor.slug} />
              <small id="settings-slug-help">{kind === 'page' ? '/blog/pages/' : '/articles/'}{editor.slug} · 小写字母、数字与连接号</small>
            </label>
            {kind === 'post' && <label className="settings-field" htmlFor="settings-cover">
              <span className="settings-field__heading"><span>封面链接</span><span className="settings-field__hint">可选</span></span>
              <input id="settings-cover" onChange={(event) => onChange({ ...editor, coverImageUrl: event.currentTarget.value })} type="url" value={editor.coverImageUrl} />
            </label>}
          </div>
          <label className="settings-field" htmlFor="settings-excerpt">
            <span className="settings-field__heading"><span>摘要</span><span className="settings-field__hint">留空时从正文生成</span></span>
            <textarea id="settings-excerpt" style={{ resize: 'none' }} onChange={(event) => onChange({ ...editor, excerpt: event.currentTarget.value })} maxLength={500} rows={3} value={editor.excerpt} />
          </label>
          {feedback && <p className="studio-form-error" role="alert">{feedback}</p>}
        </div>
        <footer className="markdown-settings-modal__footer">
          <button className="text-button text-button--danger" disabled={!editor.id || isSaving} type="button" onClick={() => { onClose(); onDelete() }}>删除{label}</button>
          <div>
            {kind === 'page' && editor.status === 'published' && <button className="secondary-button" disabled={isSaving} type="button" onClick={() => { onClose(); onUnpublish?.() }}>撤回发布</button>}
            {editor.status === 'draft' && <button className="secondary-button" disabled={isSaving} type="button" onClick={() => onSave('draft')}>保存草稿</button>}
            <button className="primary-button" disabled={isSaving} type="button" onClick={() => { onClose(); onSave('published') }}>{editor.status === 'published' ? '检查并更新发布' : '检查并发布'}</button>
          </div>
        </footer>
      </section>
    </dialog>
  )
}

export function MarkdownEditor({
  attachmentAccess,
  kind = 'post',
  onUnpublish,
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
  kind?: 'post' | 'page'
  attachmentAccess?: EditorAttachmentAccess
  onUnpublish?: () => void
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
} & Partial<ArticleTaxonomyActions>) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAttachmentOpen, setIsAttachmentOpen] = useState(false)
  const sourceInsertion = useRef<{ view: EditorView; from: number; to: number } | null>(null)
  const editorWorkspaceRef = useRef<HTMLDivElement>(null)
  const markdownRef = useRef<MDXEditorMethods>(null)
  const sourcePreferred = useMemo(() => requiresMarkdownSource(editor.contentMarkdown), [editor.contentMarkdown])
  const [sourceFallback, setSourceFallback] = useState<{ id: string | null; enabled: boolean }>(() => ({ id: editor.id, enabled: sourcePreferred }))
  const sourceOnly = sourceFallback.id === editor.id ? sourceFallback.enabled : sourcePreferred
  const outlineItems = useMemo(() => getArticleHeadings(editor.contentMarkdown), [editor.contentMarkdown])
  const [activeHeading, setActiveHeading] = useState('')
  const stats = articleStats(editor.contentMarkdown)
  const label = kind === 'page' ? '页面' : '文章'
  const onAttachmentOpenChange = attachmentAccess?.onOpenChange

  function navigateHeading(item: ArticleHeading, index: number) {
    setActiveHeading(item.id)
    const source = editorWorkspaceRef.current?.querySelector<HTMLElement>('.mdxeditor-source-editor .cm-editor')
    const view = source ? EditorView.findFromDOM(source) : null
    if (view) {
      const from = view.state.doc.line(Math.min(item.line, view.state.doc.lines)).from
      view.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: 'start' }) })
      view.focus()
      return
    }
    const heading = editorWorkspaceRef.current?.querySelectorAll<HTMLElement>('.genesis-mdx-content :is(h1,h2,h3,h4,h5,h6)')[index]
    heading?.scrollIntoView({ block: 'start' })
  }

  useEffect(() => {
    onAttachmentOpenChange?.(isAttachmentOpen)
    return () => onAttachmentOpenChange?.(false)
  }, [isAttachmentOpen, onAttachmentOpenChange])

  function openAttachments() {
    const source = editorWorkspaceRef.current?.querySelector<HTMLElement>('.mdxeditor-source-editor .cm-editor')
    const view = source ? EditorView.findFromDOM(source) : null
    sourceInsertion.current = view ? { view, from: view.state.selection.main.from, to: view.state.selection.main.to } : null
    setIsAttachmentOpen(true)
  }
  function closeAttachments() {
    setIsAttachmentOpen(false)
    // 工具栏可能随编辑器重绘，查找当前入口，避免恢复到已卸载的按钮。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const trigger = editorWorkspaceRef.current?.querySelector<HTMLButtonElement>('.editor-attachment-trigger')
      if (trigger?.isConnected && !trigger.closest('[inert]')) trigger.focus()
    }))
  }
  function insertAttachment(item: Attachment) {
    const markdown = attachmentMarkdown(item)
    const source = sourceInsertion.current
    setIsAttachmentOpen(false)
    // 模态关闭并恢复焦点后，使用编辑器原生事务保留光标与撤销历史。
    requestAnimationFrame(() => {
      if (source?.view.dom.isConnected) {
        source.view.dispatch({ changes: { from: source.from, to: source.to, insert: markdown }, selection: { anchor: source.from + markdown.length } })
        source.view.focus()
      } else markdownRef.current?.focus(() => markdownRef.current?.insertMarkdown(markdown), { preventScroll: true })
    })
  }

  useEffect(() => {
    if (markdownRef.current?.getMarkdown() !== editor.contentMarkdown) markdownRef.current?.setMarkdown(editor.contentMarkdown)
  }, [editor.contentMarkdown])

  return (
    <section className="markdown-editor" aria-labelledby="markdown-editor-title">
      <div className="markdown-editor__main">
      <header className="markdown-editor__header">
        <div className="markdown-editor__identity">
          <button className="text-button" type="button" onClick={onBack}>← 返回{label}列表</button>
          <div className="markdown-editor__title-row">
            <span className="markdown-editor__eyebrow">{label}写作</span>
            <span className={`post-status post-status--${editor.status}`}>{editor.status === 'published' ? '已发布' : '草稿'}</span>
            <span className="markdown-editor__save-state" role="status">{saveState}</span>
          </div>
          <textarea aria-label={`${label}标题`} className="markdown-editor__title" id="markdown-editor-title" rows={1} style={{ resize: 'none' }} disabled={isSaving || recovery !== null} maxLength={200} onChange={(event) => onChange({ ...editor, title: event.currentTarget.value.replace(/\n/g, '') })} placeholder={`输入${label}标题`} value={editor.title} />
        </div>
        <div className="markdown-editor__actions">
          <FpsStatusSlot />
          {kind === 'page' && editor.status === 'published' && <a className="page-public-link" href={'/blog/pages/' + encodeURIComponent(editor.slug)} target="_blank" rel="noopener noreferrer">查看公开页面 ↗</a>}
          <button className="secondary-button" disabled={isSaving || recovery !== null} type="button" onClick={onPreview}><StudioIcon name="eye" /> 预览</button>
          <button className="secondary-button" disabled={isSaving || recovery !== null} type="button" aria-label={`打开${label}设置`} onClick={() => setIsSettingsOpen(true)}><StudioIcon name="settings" /> 设置</button>
          {editor.status === 'draft' && <button className="secondary-button" disabled={isSaving || recovery !== null} type="button" onClick={() => onSave('draft')}>保存草稿</button>}
          <button className="primary-button" disabled={isSaving || recovery !== null} type="button" onClick={() => onSave('published')}>{editor.status === 'published' ? '更新发布' : '发布'}</button>
        </div>
      </header>
      {feedback && <p className="markdown-editor__feedback" role="status">{feedback}</p>}
      {hasVersionConflict && <div className="markdown-editor__recovery"><span>站点上的{label}已经更新，请先核对两个版本。</span><button type="button" disabled={isSaving} onClick={onCompareVersion}>核对站点版本</button></div>}
      {recovery && <div className="markdown-editor__recovery" role="status">
        <span>发现本标签页未保存的内容{recovery.editor.updatedAt !== editor.updatedAt ? '，站点版本可能已更新，请核对后保存' : ''}。</span>
        <button type="button" onClick={onRestoreDraft}>恢复内容</button>
        <button type="button" onClick={onDiscardDraft}>丢弃本地内容</button>
      </div>}
      <div className="markdown-editor__workspace markdown-editor__workspace--mdx" ref={editorWorkspaceRef}>
        <section className={`markdown-editor__source markdown-editor__source--mdx${sourceOnly ? ' is-source-compatible' : ''}`} aria-label="Markdown 编辑区">
          {sourceOnly && <p className="markdown-editor__compatibility" role="status">本文使用扩展语法，已切换为源码编辑以完整保留内容。点击“预览”查看排版效果。</p>}
          {sourceOnly ? <div className="genesis-mdx-editor">
            <div className="genesis-source-toolbar"><GenesisToolbar sourceOnly disabled={isSaving || recovery !== null} onAttachment={attachmentAccess ? openAttachments : undefined} /></div>
            <MarkdownSourceEditor key={editor.id ?? 'new'} content={editor.contentMarkdown} readOnly={isSaving || recovery !== null} onChange={contentMarkdown => { if (contentMarkdown !== editor.contentMarkdown) onChange({ ...editor, contentMarkdown }) }} />
          </div> : <MDXEditor
            ref={markdownRef}
            key={`${editor.id ?? 'new'}:${sourceOnly ? 'source' : 'rich'}`}
            className="genesis-mdx-editor"
            contentEditableClassName="genesis-mdx-content"
            markdown={editor.contentMarkdown}
            trim={false}
            placeholder={kind === 'page' ? '撰写关于、说明或专题内容。' : '写下你的想法，或打开博客助手一起构思。'}
            readOnly={isSaving || recovery !== null}
            onChange={(contentMarkdown, initialMarkdownNormalize) => {
              if (!initialMarkdownNormalize && contentMarkdown !== editor.contentMarkdown) onChange({ ...editor, contentMarkdown })
            }}
            onError={() => { if (!sourceOnly) queueMicrotask(() => setSourceFallback({ id: editor.id, enabled: true })) }}
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
              diffSourcePlugin({ viewMode: sourceOnly ? 'source' : 'rich-text', codeMirrorExtensions: [genesisCodeBlockTheme] }),
              markdownShortcutPlugin(),
              toolbarPlugin({ toolbarContents: () => <GenesisToolbar sourceOnly={sourceOnly} onAttachment={attachmentAccess ? openAttachments : undefined} disabled={isSaving || recovery !== null} /> }),
            ]}
            spellCheck={false}
          />}
        </section>
      </div>
      <footer className="markdown-editor__writing-meta"><span>{stats.count.toLocaleString('zh-CN')} 字 · 预计阅读 {stats.minutes} 分钟</span><span>未保存内容仅保留在本标签页</span></footer>
      </div>
      <div className="markdown-editor__toc"><ArticleToc items={outlineItems} activeId={activeHeading} label={`${label}目录`} onNavigate={navigateHeading} /></div>
      {isAttachmentOpen && attachmentAccess && <EditorAttachmentPicker access={attachmentAccess} onClose={closeAttachments} onInsert={insertAttachment} />}
      {isSettingsOpen && <PostSettingsModal kind={kind} onUnpublish={onUnpublish} categories={categories} editor={editor} feedback={feedback} isSaving={isSaving} onChange={onChange} onClose={() => setIsSettingsOpen(false)} onDelete={onDelete} onSave={onSave} tags={tags} onCreateTaxonomy={onCreateTaxonomy} onSelectTaxonomy={onSelectTaxonomy} />}
    </section>
  )
}

export function ArticleReader({
  kind = 'post',
  editor,
  onBack,
  onEdit,
}: {
  kind?: 'post' | 'page'
  editor: EditorState
  onBack: () => void
  onEdit: () => void
}) {
  const label = kind === 'page' ? '页面' : '文章'
  return (
    <section className="article-reader" aria-labelledby="article-reader-title">
      <header className="article-reader__header">
        <div className="article-reader__heading">
          <button className="text-button article-reader__back" type="button" onClick={onBack}>← 返回{label}列表</button>
          <div className="article-reader__eyebrow">{editor.status === 'published' ? 'PUBLISHED' : 'DRAFT'} {kind === 'page' ? 'PAGE' : 'ARTICLE'}</div>
          <h1 id="article-reader-title">{editor.title || `未命名${label}`}</h1>
          {(editor.excerpt || kind === 'post') && <p>{editor.excerpt || '还没有摘要，打开编辑设置补充文章信息。'}</p>}
          {editor.selectedTagSlugs.length > 0 && <div className="article-reader__meta"><span>{editor.selectedTagSlugs.join(' · ')}</span></div>}
        </div>
        <div className="article-reader__actions">
          <span className={`post-status post-status--${editor.status}`}>
            {editor.status === 'published' ? '已发布' : '草稿'}
          </span>
          <button className="primary-button" type="button" onClick={onEdit}>编辑{label}</button>
        </div>
      </header>
      <ArticleDocument className="article-reader__document" label={`${label}目录`} content={editor.contentMarkdown || '开始输入 Markdown 内容。'} />
    </section>
  )
}
