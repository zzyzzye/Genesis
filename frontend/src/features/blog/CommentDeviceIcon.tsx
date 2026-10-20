import { useState } from 'react'
import { Globe, Monitor } from 'lucide-react'
import windowsUrl from '../../assets/comment-devices/windows.svg'
import windows10Url from '../../assets/comment-devices/windows10.svg'
import windows7Url from '../../assets/comment-devices/windows7.svg'
import macosUrl from '../../assets/comment-devices/macos.svg'
import iosUrl from '../../assets/comment-devices/ios.svg'
import androidUrl from '../../assets/comment-devices/android.svg'
import linuxUrl from '../../assets/comment-devices/linux.svg'
import ubuntuUrl from '../../assets/comment-devices/ubuntu.svg'
import debianUrl from '../../assets/comment-devices/debian.svg'
import fedoraUrl from '../../assets/comment-devices/fedora.svg'
import archUrl from '../../assets/comment-devices/arch.svg'
import centosUrl from '../../assets/comment-devices/centos.svg'
import suseUrl from '../../assets/comment-devices/suse.svg'
import mintUrl from '../../assets/comment-devices/mint.svg'
import deepinUrl from '../../assets/comment-devices/deepin.svg'
import kaliUrl from '../../assets/comment-devices/kali.svg'
import chromeUrl from '../../assets/comment-devices/chrome.svg'
import harmonyUrl from '../../assets/comment-devices/harmony.svg'
import bsdUrl from '../../assets/comment-devices/bsd.svg'
import openbsdUrl from '../../assets/comment-devices/openbsd.svg'
import netbsdUrl from '../../assets/comment-devices/netbsd.svg'
import tizenUrl from '../../assets/comment-devices/tizen.svg'
import webosUrl from '../../assets/comment-devices/webos.svg'
import kaiosUrl from '../../assets/comment-devices/kaios.svg'
import blackberryUrl from '../../assets/comment-devices/blackberry.svg'
import symbianUrl from '../../assets/comment-devices/symbian.svg'
import chromiumUrl from '../../assets/comment-devices/chromium.svg'
import edgeUrl from '../../assets/comment-devices/edge.svg'
import safariUrl from '../../assets/comment-devices/safari.svg'
import firefoxUrl from '../../assets/comment-devices/firefox.svg'
import operaUrl from '../../assets/comment-devices/opera.svg'
import samsungUrl from '../../assets/comment-devices/samsung.svg'
import ieUrl from '../../assets/comment-devices/ie.svg'
import braveUrl from '../../assets/comment-devices/brave.svg'
import vivaldiUrl from '../../assets/comment-devices/vivaldi.svg'
import qqUrl from '../../assets/comment-devices/qq.svg'
import ucUrl from '../../assets/comment-devices/uc.svg'
import yandexUrl from '../../assets/comment-devices/yandex.svg'

// 使用本地品牌素材，保留原始曲线、渐变和比例；来源与许可见资源目录 README。
const icons = {
  windows: windowsUrl,
  windows11: windowsUrl,
  windows10: windows10Url,
  windows7: windows7Url,
  macos: macosUrl,
  ios: iosUrl,
  android: androidUrl,
  linux: linuxUrl,
  ubuntu: ubuntuUrl,
  debian: debianUrl,
  fedora: fedoraUrl,
  arch: archUrl,
  centos: centosUrl,
  suse: suseUrl,
  mint: mintUrl,
  deepin: deepinUrl,
  kali: kaliUrl,
  chromeos: chromeUrl,
  harmony: harmonyUrl,
  bsd: bsdUrl,
  openbsd: openbsdUrl,
  netbsd: netbsdUrl,
  tizen: tizenUrl,
  webos: webosUrl,
  kaios: kaiosUrl,
  blackberry: blackberryUrl,
  symbian: symbianUrl,
  chrome: chromeUrl,
  chromium: chromiumUrl,
  edge: edgeUrl,
  safari: safariUrl,
  firefox: firefoxUrl,
  opera: operaUrl,
  samsung: samsungUrl,
  ie: ieUrl,
  brave: braveUrl,
  vivaldi: vivaldiUrl,
  qq: qqUrl,
  uc: ucUrl,
  yandex: yandexUrl,
}

type IconName = keyof typeof icons | 'genericSystem' | 'genericBrowser'
type IconRule = readonly [RegExp, IconName]
const systemRules: readonly IconRule[] = [
  [/^windows\s+(?:7|vista|xp)(?:\b|\.)/, 'windows7'],
  [/^windows\s+(?:8(?:\.1)?|10)(?:\b|\.)/, 'windows10'],
  [/^windows\s+11(?:\b|\.)/, 'windows11'],
  [/^windows\b/, 'windows'],
  [/^(?:mac\s?os(?:\s?x)?|os x)\b/, 'macos'],
  [/^(?:ios|ipados|iphone os)\b/, 'ios'],
  [/^android\b/, 'android'],
  [/^(?:chrome\s?os|chromium os)\b/, 'chromeos'],
  [/^(?:harmony\s?os|openharmony)\b|^鸿蒙/u, 'harmony'],
  [/^(?:ubuntu|kubuntu|xubuntu|lubuntu)\b/, 'ubuntu'],
  [/^debian\b/, 'debian'], [/^fedora\b/, 'fedora'], [/^(?:arch|archlinux|arch linux)\b/, 'arch'],
  [/^centos\b/, 'centos'], [/^(?:opensuse|suse)\b/, 'suse'],
  [/^(?:linux mint|mint)\b/, 'mint'], [/^deepin\b/, 'deepin'], [/^kali\b/, 'kali'],
  [/^(?:kylin|openkylin|麒麟)/u, 'genericSystem'], [/^openbsd\b/, 'openbsd'], [/^netbsd\b/, 'netbsd'], [/^(?:freebsd|bsd)\b/, 'bsd'],
  [/^tizen\b/, 'tizen'], [/^(?:webos|web0s)\b/, 'webos'], [/^kaios\b/, 'kaios'],
  [/^(?:blackberry|rim tablet os)\b/, 'blackberry'], [/^symbian\b/, 'symbian'], [/^(?:linux|gnu\/linux)\b/, 'linux'],
]
const browserRules: readonly IconRule[] = [
  [/^(?:edge|microsoft edge)\b/, 'edge'], [/^chromium\b/, 'chromium'],
  [/^(?:chrome|google chrome|headlesschrome|chrome webview)\b/, 'chrome'],
  [/^(?:mobile safari|safari)\b/, 'safari'], [/^(?:firefox|firefox mobile|firefox ios)\b/, 'firefox'],
  [/^(?:opera|opera mobile|opera mini)\b/, 'opera'], [/^samsung internet\b/, 'samsung'],
  [/^(?:ie|ie mobile|iemobile|internet explorer)\b/, 'ie'], [/^brave\b/, 'brave'], [/^vivaldi\b/, 'vivaldi'],
  [/^(?:qqbrowser|qq browser|qq browser mobile)\b/, 'qq'], [/^(?:uc browser|ucbrowser|ucweb)\b/, 'uc'], [/^yandex\b/, 'yandex'],
]

export function CommentDeviceIcon({ kind, name }: { kind: 'system' | 'browser'; name: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const fallback = kind === 'system' ? 'genericSystem' : 'genericBrowser'
  const rules = kind === 'system' ? systemRules : browserRules
  const icon = rules.find(([pattern]) => pattern.test(name.trim().toLowerCase()))?.[1] ?? fallback
  if (icon === 'genericSystem' || icon === 'genericBrowser') {
    const Glyph = icon === 'genericSystem' ? Monitor : Globe
    return <Glyph className="comment-device-icon" data-device-icon={icon} size={16} aria-hidden="true" focusable="false" />
  }
  const src = icons[icon]
  if (failedSource === src) {
    const Glyph = kind === 'system' ? Monitor : Globe
    return <Glyph className="comment-device-icon" data-device-icon={fallback} size={16} aria-hidden="true" focusable="false" />
  }
  return <img className="comment-device-icon" data-device-icon={icon} src={src} width={16} height={16} alt="" aria-hidden="true" draggable={false} loading="lazy" onError={() => setFailedSource(src)} />
}
