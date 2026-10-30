import { autocompletion, completionKeymap, type CompletionContext } from '@codemirror/autocomplete'
import { Annotation, Compartment, EditorState, Prec, Transaction } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder, tooltips } from '@codemirror/view'
import { minimalSetup } from 'codemirror'
import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { imageMentionPattern, imageMentionToken, imageReferenceNumbers, type incomingReferences } from './canvasReferences'

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
  const numbers = imageReferenceNumbers(references)
  const referenceState = JSON.stringify(references.map(({ node, asset }) => ({ id: node.id, name: node.name || asset?.name || '未命名图片', ready: Boolean(asset), number: numbers.get(node.id) })))
  const change = useEffectEvent(onChange)
  const focus = useEffectEvent(onFocus)
  const blur = useEffectEvent(onBlur)
  useImperativeHandle(ref, () => ({ insertImage(id) {
    const editor = view.current
    if (!editor) return
    editor.focus()
    const { from, to } = editor.state.selection.main
    const token = `${imageMentionToken(id)} `
    editor.dispatch({ changes: { from, to, insert: token }, selection: { anchor: from + token.length } })
  } }), [])

  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({ parent: host.current, doc: initial, extensions: [
      minimalSetup, EditorView.lineWrapping, placeholder('描述画面与动作，输入 @ 引用连入的图片'),
      EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true', role: 'textbox' }),
      EditorState.phrases.of({ Completions: '图片参考', 'No completions found': '没有匹配的图片参考' }),
      EditorView.domEventHandlers({ focus: () => { focus() }, blur: () => { blur() } }),
      EditorView.updateListener.of(update => { if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(externalChange))) change(update.state.doc.toString()) }),
      EditorState.changeFilter.of(transaction => transaction.newDoc.length <= 20000),
      referenceConfig.of([]), Prec.highest(keymap.of(completionKeymap)), tooltips({ parent: document.body }),
    ] })
    view.current = editor
    return () => { view.current = null; editor.destroy() }
  }, [initial, label, referenceConfig])

  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, annotations: [externalChange.of(true), Transaction.addToHistory.of(false)] })
  }, [value])

  useEffect(() => {
    const entries = JSON.parse(referenceState) as { id: string; name: string; ready: boolean; number: number }[]
    const decorations = (editor: EditorView) => Decoration.set([...editor.state.doc.toString().matchAll(imageMentionPattern)].map(match => {
      const index = entries.findIndex(item => item.id === match[1])
      const reference = entries[index]
      const label = reference ? `@图片${reference.number} · ${reference.name}` : '@已断开图片'
      return Decoration.replace({ widget: new ImageMention(label, !reference) }).range(match.index, match.index + match[0].length)
    }))
    const mentions = ViewPlugin.fromClass(class {
      decorations
      constructor(editor: EditorView) { this.decorations = decorations(editor) }
      update(update: { view: EditorView }) { this.decorations = decorations(update.view) }
    }, { decorations: plugin => plugin.decorations, provide: plugin => EditorView.atomicRanges.of(editor => editor.plugin(plugin)?.decorations ?? Decoration.none) })
    view.current?.dispatch({ effects: referenceConfig.reconfigure([
      mentions,
      autocompletion({ icons: false, tooltipClass: () => 'media-prompt-completions', override: [(context: CompletionContext) => {
        const match = context.matchBefore(/@[^@\s[\]()]*$/u)
        if (!match || context.view?.composing) return null
        return { from: match.from, options: entries.map(entry => ({
          label: `@图片${entry.number} ${entry.name}`,
          detail: entry.ready ? '已连接' : '图片未就绪', type: 'variable',
          apply: `${imageMentionToken(entry.id)} `,
        })), validFor: /^@?[^@\s[\]()]*$/u }
      }], activateOnTyping: true }),
    ]) })
  }, [referenceConfig, referenceState])

  return <div className="media-reference-prompt" ref={host} />
}
