/** 验收共用编辑器，不访问账户或调用生成 API。 */
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './mediaCanvasNamesReview.css'
import { ReferencePrompt, type ReferencePromptHandle } from '../../src/pages/media/ReferencePrompt'
import type { Node } from '../../src/pages/media/api'

if (!import.meta.env.DEV || !['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('仅用于本地浏览器验收')

export function TextReferencesReview() {
  const [value, setValue] = useState('')
  const [connected, setConnected] = useState(true)
  const [image, setImage] = useState(() => new URLSearchParams(location.search).get('mode') === 'image')
  const [text, setText] = useState('白衬衫，窗边自然光。')
  const prompt = useRef<ReferencePromptHandle>(null)
  const source: Node = { id:'11111111-1111-4111-8111-111111111111', type:'text', asset_id:null, name:'人物设定', text, x:0, y:0, width:300, height:180 }
  return <main className="media-editor" style={{ minHeight:'100dvh', padding:24, boxSizing:'border-box' }}>
    <article className="media-node-editor" style={{ position:'relative', inset:'auto', width:'min(600px, 100%)', margin:'40px auto' }}>
      <section className="media-video-composer">
        <div className="media-video-composer-top">
          <button onClick={() => setImage(!image)}>切换到{image ? '视频' : '生图'}</button>
          <button onClick={() => setConnected(!connected)}>{connected ? '断开文字' : '连接文字'}</button>
          <button disabled={!connected} onClick={() => prompt.current?.insertReference(source.id)}>引用文字</button>
        </div>
        <ReferencePrompt key={String(image)} ref={prompt} value={value} references={connected ? [{ node:source, asset:undefined }] : []} label={image ? '图片提示词' : '镜头描述'} onChange={setValue} onFocus={() => {}} onBlur={() => {}} />
        <label>源文字<textarea aria-label="源文字" value={text} onChange={event => setText(event.target.value)} /></label>
        <output aria-label="保存的提示词" style={{ overflowWrap:'anywhere' }}>{value}</output>
      </section>
    </article>
  </main>
}

createRoot(document.getElementById('root')!).render(<TextReferencesReview />)
