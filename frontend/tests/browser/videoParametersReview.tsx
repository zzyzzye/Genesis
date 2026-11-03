/** 直接验收画布共用浮层和参数组件，不访问账户、作品或生成 API。 */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlowProvider } from '@xyflow/react'
import './mediaCanvasNamesReview.css'
import { GenerationParameters } from '../../src/pages/media/ProjectCanvas'
import { defaultGenerationSettings } from '../../src/pages/media/api'
import { VideoParameters } from '../../src/pages/media/VideoParameters'
import { ImageParameters } from '../../src/pages/media/ImageParameters'
import { imageSettingsSummary } from '../../src/pages/media/imageSettings'

if (!import.meta.env.DEV || !['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('仅用于本地浏览器验收')

export function VideoParametersReview() {
  const [image, setImage] = useState(false)
  const [settings, setSettings] = useState(defaultGenerationSettings)
  const [duration, setDuration] = useState(5)
  return <main className="media-editor" style={{ minHeight:'100dvh', display:'flex', alignItems:'flex-end', justifyContent:'center', padding:'24px', boxSizing:'border-box' }}>
    <article className="media-node-editor" style={{ position:'relative', inset:'auto', width:'min(600px, 100%)' }}>
      <section className="media-video-composer">
        <div className="media-video-composer-top"><button onClick={() => setImage(!image)}>切换到{image ? '视频' : '生图'}</button></div>
        <textarea aria-label="验收提示词" placeholder="描述想要生成的画面…" />
        <div className="media-video-generation-actions">
          <GenerationParameters key={String(image)} image={image} video={!image} summary={image ? imageSettingsSummary(settings) : `${settings.ratio} · ${settings.resolution === '2160P' ? '4K' : settings.resolution} · ${duration}s`}>
            {image ? <ImageParameters settings={settings} onChange={patch => setSettings(previous => ({ ...previous, ...patch }))} /> : <VideoParameters settings={settings} duration={duration} onChange={patch => setSettings(previous => ({ ...previous, ...patch }))} onDurationChange={setDuration} onInteractionStart={() => undefined} onInteractionEnd={() => undefined} />}
          </GenerationParameters>
        </div>
      </section>
    </article>
  </main>
}

createRoot(document.getElementById('root')!).render(<ReactFlowProvider><VideoParametersReview /></ReactFlowProvider>)
