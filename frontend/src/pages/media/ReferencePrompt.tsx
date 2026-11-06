import { autocompletion, completionKeymap, currentCompletions, selectedCompletionIndex, setSelectedCompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete'
import { Annotation, Compartment, EditorState, Prec, Transaction } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder, tooltips, type ViewUpdate } from '@codemirror/view'
import { minimalSetup } from 'codemirror'
import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { imageMentionPattern, imageMentionToken, type incomingReferences } from './canvasReferences'
import { getStoredAuthToken } from '../../lib/auth'
import { subscribeImage } from './imagePreview'

type References = ReturnType<typeof incomingReferences>
export type ReferencePromptHandle = { insertImage: (id: string) => void }
const externalChange = Annotation.define<boolean>()

class ImageMention extends WidgetType {
  constructor(readonly label: string, readonly missing: boolean) { super() }
  eq(other: ImageMention) { return other.label === this.label && other.missing === this.missing }
  toDOM() {
    const element = document.createElement('span')
    element.className = `media-prompt-mention${this.missing ? ' is-missing' : ''}`
    element.textContent = this.label
    element.title = this.missing ? '图片参考已断开，请重新连线或删除此引用' : this.label
    return element
  }
}

export function ReferencePrompt({ value, references, label, onChange, onFocus, onBlur, ref }: {
  value: string; references: References; label: string
  onChange: (text: string) => void; onFocus: () => void; onBlur: () => void
  ref?: Ref<ReferencePromptHandle>
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [initial] = useState(value)
  const [referenceConfig] = useState(() => new Compartment())
  const composing = useRef(false)
  const compositionFrame = useRef<number | null>(null)
  const reported = useRef(value)
  const [compositionVersion, setCompositionVersion] = useState(0)
  const session = getStoredAuthToken()
  const referenceState = JSON.stringify(references.map(({ node, asset }) => ({ id: node.id, name: node.name || asset?.name || '未命名图片', assetId: asset?.id })))
  const change = useEffectEvent(onChange)
  const focus = useEffectEvent(onFocus)
  const blur = useEffectEvent(onBlur)
  useImperativeHandle(ref, () => ({ insertImage(id) {
    const editor = view.current
    if (!editor || composing.current || editor.compositionStarted || !references.some(({ node }) => node.id === id)) return
    editor.focus()
    const { from, to } = editor.state.selection.main
    const token = `${imageMentionToken(id)} `
    editor.dispatch({ changes: { from, to, insert: token }, selection: { anchor: from + token.length } })
  } }), [references])

  useEffect(() => {
    if (!host.current) return
    const report = (editor: EditorView) => {
      const text = editor.state.doc.toString()
      if (text === reported.current) return
      reported.current = text
      change(text)
    }
    const editor = new EditorView({ parent: host.current, doc: initial, extensions: [
      minimalSetup, EditorView.lineWrapping, placeholder('描述想要生成的内容，输入 @ 引用已连入的图片'),
      EditorView.theme({
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'currentColor' },
        '.cm-content ::selection, .cm-content::selection': { backgroundColor: '#505050', color: '#ffffff' },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#505050' },
      }),
      EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true', role: 'textbox' }),
      EditorState.phrases.of({ Completions: '图片参考', 'No completions found': '没有匹配的图片参考' }),
      EditorView.domEventHandlers({
        focus: () => { focus() }, blur: () => { blur() },
        compositionstart: () => {
          composing.current = true
          if (compositionFrame.current !== null) cancelAnimationFrame(compositionFrame.current)
          compositionFrame.current = null
        },
        compositionend: (_event, editor) => {
          composing.current = false
          // 等 CodeMirror 读取最终 DOM 后再回写，拼音中间态不触发画布重绘或保存。
          compositionFrame.current = requestAnimationFrame(() => {
            compositionFrame.current = null
            if (view.current !== editor || composing.current) return
            report(editor)
            setCompositionVersion(version => version + 1)
          })
        },
      }),
      EditorView.updateListener.of(update => { if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(externalChange))) {
        if (!composing.current && !update.view.compositionStarted && compositionFrame.current === null) report(update.view)
      } }),
      EditorState.changeFilter.of(transaction => transaction.newDoc.length <= 20000),
      referenceConfig.of([]), Prec.highest(keymap.of(completionKeymap)), tooltips({ parent: document.body }),
    ] })
    view.current = editor
    return () => {
      if (compositionFrame.current !== null) cancelAnimationFrame(compositionFrame.current)
      compositionFrame.current = null; composing.current = false
      view.current = null; editor.destroy()
    }
  }, [initial, label, referenceConfig])

  useEffect(() => {
    const editor = view.current
    if (!editor || composing.current || editor.compositionStarted || compositionFrame.current !== null) return
    reported.current = value
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, annotations: [externalChange.of(true), Transaction.addToHistory.of(false)] })
  }, [value, compositionVersion])

  useEffect(() => {
    if (composing.current || view.current?.compositionStarted || compositionFrame.current !== null) return
    const entries = JSON.parse(referenceState) as { id: string; name: string; assetId?: string }[]
    const choices = entries
    const previews = new Map<string, { dom: HTMLElement; release?: () => void }>()
    const previewLifecycle = ViewPlugin.define(() => ({ destroy() {
      previews.forEach(preview => preview.release?.())
      previews.clear()
    } }))
    const renderOption = (completion: Completion, _state: EditorState, editor: EditorView) => {
      const entry = choices.find(choice => choice.id === (completion as Completion & { referenceId: string }).referenceId)!
      const existing = previews.get(entry.id)
      const dom = existing?.dom ?? document.createElement('span')
      dom.className = 'media-reference-option'
      // 浮层挂在 body，字号按画布缩放后的实际文字尺寸设置。
      const style = getComputedStyle(editor.contentDOM)
      const scale = editor.contentDOM.getBoundingClientRect().width / editor.contentDOM.offsetWidth || 1
      dom.style.fontSize = `${parseFloat(style.fontSize) * scale}px`
      dom.style.fontFamily = style.fontFamily
      if (existing) return dom
      const thumbnail = document.createElement('span')
      thumbnail.className = 'media-reference-option-image'
      thumbnail.textContent = '图'
      thumbnail.setAttribute('aria-hidden', 'true')
      const name = document.createElement('span')
      name.className = 'media-reference-option-name'
      name.textContent = entry.name
      const detail = document.createElement('span')
      detail.className = 'media-reference-option-detail'
      detail.textContent = completion.detail ?? ''
      dom.append(thumbnail, name, detail)
      dom.addEventListener('pointermove', () => {
        const index = currentCompletions(editor.state).findIndex(option => (option as Completion & { referenceId: string }).referenceId === entry.id)
        if (index >= 0 && selectedCompletionIndex(editor.state) !== index) editor.dispatch({ effects: setSelectedCompletion(index) })
      })
      const release = entry.assetId ? subscribeImage(entry.assetId, session, state => {
        thumbnail.replaceChildren()
        if (state.url) {
          thumbnail.title = ''
          const image = document.createElement('img')
          image.alt = ''
          image.src = state.url
          image.addEventListener('error', () => { thumbnail.textContent = '图'; thumbnail.title = '图片预览暂不可用' })
          thumbnail.append(image)
        } else {
          thumbnail.textContent = '图'
          thumbnail.title = state.error || '正在加载图片'
        }
      }) : undefined
      previews.set(entry.id, { dom, release })
      return dom
    }
    const decorations = (editor: EditorView) => Decoration.set([...editor.state.doc.toString().matchAll(imageMentionPattern)].map(match => {
      const index = entries.findIndex(item => item.id === match[1])
      const reference = entries[index]
      const label = reference?.name ?? '已断开图片'
      return Decoration.replace({ widget: new ImageMention(label, !reference) }).range(match.index, match.index + match[0].length)
    }))
    const mentions = ViewPlugin.fromClass(class {
      decorations
      constructor(editor: EditorView) { this.decorations = decorations(editor) }
      update(update: ViewUpdate) {
        if (!update.docChanged) return
        this.decorations = composing.current || update.view.compositionStarted
          ? this.decorations.map(update.changes) : decorations(update.view)
      }
    }, { decorations: plugin => plugin.decorations, provide: plugin => EditorView.atomicRanges.of(editor => editor.plugin(plugin)?.decorations ?? Decoration.none) })
    view.current?.dispatch({ effects: referenceConfig.reconfigure([
      mentions,
      previewLifecycle,
      autocompletion({ icons: false, addToOptions: [{ position: 20, render: renderOption }], tooltipClass: () => 'media-prompt-completions', override: [(context: CompletionContext) => {
        const match = context.matchBefore(/@[^@\s[\]()]*$/u)
        if (!match || composing.current || context.view?.compositionStarted) return null
        return { from: match.from, options: choices.map(entry => ({
          label: `@${entry.name}`, displayLabel: entry.name, referenceId: entry.id,
          detail: !entry.assetId ? '图片未就绪' : '已连接', type: 'variable',
          apply: (editor: EditorView, _completion: unknown, from: number, to: number) => {
            const token = `${imageMentionToken(entry.id)} `
            editor.dispatch({ changes: { from, to, insert: token }, selection: { anchor: from + token.length } })
          },
        })), validFor: /^@?[^@\s[\]()]*$/u }
      }], activateOnTyping: true }),
    ]) })
  }, [referenceConfig, referenceState, session, compositionVersion])

  return <div className="media-reference-prompt" ref={host} />
}
