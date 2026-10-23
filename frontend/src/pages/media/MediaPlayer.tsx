import { Audio, AudioPlayer, NeutralAudioSkin } from '@videojs/react/audio'
import { Video, VideoPlayer, NeutralVideoSkin } from '@videojs/react/video'
import { I18nProvider } from '@videojs/react/i18n'
import zhCN from '@videojs/react/i18n/locales/zh-CN'
import '@videojs/react/audio/neutral-skin.css'
import '@videojs/react/video/neutral-skin.css'
import './MediaPlayer.css'

export default function MediaPlayer({ src, kind, name, onError }: {
  src: string
  kind: 'audio' | 'video'
  name: string
  onError: () => void
}) {
  return <div className={`media-player-shell is-${kind} nodrag nopan nowheel`} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <I18nProvider locale="zh-CN" translations={zhCN}>
      {kind === 'audio' ? <AudioPlayer>
        <NeutralAudioSkin className="media-asset-player" aria-label={`音频播放器：${name}`}>
          <Audio src={src} preload="metadata" onError={onError} />
        </NeutralAudioSkin>
      </AudioPlayer> : <VideoPlayer>
        <NeutralVideoSkin className="media-asset-player" aria-label={`视频播放器：${name}`}>
          <Video src={src} preload="metadata" playsInline onError={onError} />
        </NeutralVideoSkin>
      </VideoPlayer>}
    </I18nProvider>
  </div>
}
