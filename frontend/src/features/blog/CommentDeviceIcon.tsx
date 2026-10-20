import type { ReactNode } from 'react'

// 小尺寸手绘 SVG；所有颜色随组件打包，不向第三方图片服务请求设备资料。
const chrome = <><path fill="#ea4335" d="M12 2a10 10 0 0 1 8.66 5H12a5 5 0 0 0-4.33 2.5L4.2 3.9A10 10 0 0 1 12 2Z" /><path fill="#fbbc05" d="M20.66 7A10 10 0 0 1 12 22l4.33-7.5A5 5 0 0 0 12 7Z" /><path fill="#34a853" d="M12 22A10 10 0 0 1 4.2 3.9l4.13 7.16a5 5 0 0 0 8 3.44Z" /><circle cx="12" cy="12" r="4.5" fill="#4285f4" stroke="#fff" strokeWidth="1.2" /></>
const windows = <path fill="#0078d4" d="M2 3h9v8H2Zm11 0h9v8h-9ZM2 13h9v8H2Zm11 0h9v8h-9Z" />
const android = <><path fill="#3ddc84" d="M3 12a9 9 0 0 1 18 0v6H3Z" /><path stroke="#3ddc84" strokeWidth="1.5" strokeLinecap="round" d="m6 5-2-3m14 3 2-3" /><circle cx="8" cy="11" r="1" fill="#fff" /><circle cx="16" cy="11" r="1" fill="#fff" /><path stroke="#3ddc84" strokeWidth="3" strokeLinecap="round" d="M7 18v3m10-3v3" /></>
const linux = <><path fill="#242424" d="M6 16c0-3 2-4 2-8 0-7 8-7 8 0 0 4 2 5 2 8l-2 5H8Z" /><ellipse cx="12" cy="15" rx="5" ry="6" fill="#fff" /><ellipse cx="10" cy="7.5" rx="1.5" ry="2" fill="#fff" /><ellipse cx="14" cy="7.5" rx="1.5" ry="2" fill="#fff" /><circle cx="10.4" cy="7.7" r=".6" fill="#242424" /><circle cx="13.6" cy="7.7" r=".6" fill="#242424" /><path fill="#f4bd27" d="m9 10 3-2 3 2-3 2Zm-4 8 5 1-1 3H2Zm14 0-5 1 1 3h7Z" /></>
const bsd = <><path fill="#cf2727" d="m4 8-2-6 7 3a9 9 0 0 1 6 0l7-3-2 6a9 9 0 1 1-16 0Z" /><path d="m6 6-2-2 1 5m13-3 2-2-1 5" fill="#f2877b" /><path d="M8 11c2-3 6-3 8 0" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" /></>

const icons = {
  windows,
  macos: <><rect x="2" y="2" width="20" height="20" rx="4" fill="#2088ec" /><path fill="#91d7ff" d="M12 2h6a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4h-6l2-10h-3Z" /><path d="M7 8v2m10-2v2M7 15c3 3 7 3 10 0" stroke="#123d70" strokeWidth="1.4" strokeLinecap="round" fill="none" /></>,
  ios: <><rect x="2" y="2" width="20" height="20" rx="5" fill="#6678f5" /><path fill="#fff" d="M15.3 7c-.3 1.4-1.2 2-2.3 2 .1-1.3 1-2.1 2.3-2ZM16 10c-1.2-.8-2.2-.2-3 .1-.8-.3-2-.9-3.1-.1-2 1.4-1.2 5.1.4 7 .7 1 1.4.6 2.5.3 1 .3 1.9.7 2.6-.3.7-.9 1.2-1.7 1.5-2.7-1.8-.9-2-2.8-.9-4.3Z" /></>,
  android,
  linux,
  ubuntu: <><circle cx="12" cy="12" r="10" fill="#e95420" /><circle cx="12" cy="12" r="5" fill="none" stroke="#fff" strokeWidth="2" /><path d="m12 5 0 3m-6 8 3-1m9 1-3-1" stroke="#e95420" strokeWidth="3" /><g fill="#fff"><circle cx="12" cy="5" r="2" /><circle cx="6" cy="16" r="2" /><circle cx="18" cy="16" r="2" /></g></>,
  debian: <path d="M13 13c5 1 6-6 2-8-5-3-11 2-10 7 1 6 7 9 13 7-5 0-9-2-10-6-1-3 2-6 5-5 3 1 2 4 0 5Zm-3 9c-7-4-9-11-5-17C9-1 19 1 21 7" fill="none" stroke="#d70751" strokeWidth="1.8" strokeLinecap="round" />,
  fedora: <><path fill="#294172" d="M12 2a10 10 0 1 1-10 10V2Z" /><path d="M14 7c-4-2-7 0-7 4 0 5 5 6 7 2V7c0-4 5-4 5-1m-9 4h7" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none" /></>,
  arch: <><path fill="#1793d1" d="m12 1 10 21-7-3c1-6-7-6-6 0l-7 3Z" /><path d="m6 11 4 2" stroke="#fff" strokeWidth="1.3" /></>,
  centos: <><path fill="#932279" d="m12 2 5 5-5 5-5-5Z" /><path fill="#efa724" d="m22 12-5 5-5-5 5-5Z" /><path fill="#262577" d="m12 22-5-5 5-5 5 5Z" /><path fill="#9ccd2a" d="m2 12 5-5 5 5-5 5Z" /><path d="m12 5 7 7-7 7-7-7Z" fill="none" stroke="#fff" strokeWidth="1.2" /></>,
  suse: <><path d="M3 14c-2-8 9-11 15-6l4 3-4 3h-6c-4 0-4 6 0 6 5 0 5-6 1-6" fill="none" stroke="#73ba25" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><circle cx="17" cy="9.5" r="1" fill="#173f0e" /></>,
  mint: <><path fill="#87bf3e" d="M2 3h15a5 5 0 0 1 5 5v13H7a5 5 0 0 1-5-5Z" /><path d="M7 7v10h11V9l-3 3-3-3v8" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /></>,
  deepin: <><circle cx="12" cy="12" r="10" fill="#007cff" /><path d="M8 6v12h4a6 6 0 0 0 0-12Z" fill="none" stroke="#fff" strokeWidth="2" /><path d="M8 12h7" stroke="#fff" strokeWidth="2" /></>,
  kali: <path d="M2 16c4-7 9 5 14-1 5-6-4-9-1-12l7 4-4 1m-3 7c-1 5-5 7-9 6m2-8c0-6 3-10 8-10" fill="none" stroke="#2684c7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  kylin: <><circle cx="12" cy="12" r="10" fill="#e95b24" /><path d="M8 5v14m9-13-8 8m2-2 7 7" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" /></>,
  chromeos: chrome,
  harmony: <><circle cx="12" cy="12" r="10" fill="#1260e8" /><path d="M6 16h12M7 11a5 5 0 1 1 10 0M10 11a2 2 0 1 0 4 0" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></>,
  bsd,
  openbsd: <><path fill="#efbc36" d="m12 2 2 3 4-1 1 4 4 2-3 3 1 4-4 1-2 4-3-2-4 2-1-4-4-1 1-4-3-3 4-2 1-4 4 1Z" /><circle cx="14" cy="10" r="2.3" fill="#fff" /><circle cx="14.6" cy="10" r="1" fill="#252525" /><path d="m16 15 3-1" stroke="#6e561f" strokeWidth="1.4" /></>,
  netbsd: <><path d="M4 2v20" stroke="#3b3b3b" strokeWidth="1.8" /><path d="M5 3c5-4 10 4 17 0l-3 9c-7 4-10-4-14 0Z" fill="#f26711" /></>,
  tizen: <><circle cx="12" cy="12" r="10" fill="#1397dd" /><path d="M5 7c4-3 10 3 14-1M12 8v11" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" /></>,
  webos: <><circle cx="12" cy="12" r="10" fill="#b33394" /><path d="m5 9 3 7 4-6 4 6 3-7" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /></>,
  kaios: <><rect x="2" y="2" width="20" height="20" rx="5" fill="#6f02b5" /><path d="M8 6v12m9-12-8 6 8 6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></>,
  blackberry: <g fill="#365a87"><path d="M4 3h5l-1 4H3Zm7 0h5l-1 4h-5ZM3 9h5l-1 4H2Zm7 0h5l-1 4H9Zm7 0h5l-1 4h-5ZM9 15h5l-1 4H8Zm7 0h5l-1 4h-5Z" /></g>,
  symbian: <><circle cx="12" cy="12" r="10" fill="#65a636" /><path d="M17 7c-8-5-13 3-5 5 8 2 3 10-5 5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></>,
  chrome,
  chromium: <><circle cx="12" cy="12" r="10" fill="#b4d9f7" /><path d="M12 2a10 10 0 0 1 8.7 5H12l-4.3 2.5L4.2 3.9ZM12 22 8 15 3 8a10 10 0 0 0 9 14Z" fill="#438ccc" /><circle cx="12" cy="12" r="4.5" fill="#2870b7" stroke="#fff" strokeWidth="1.2" /></>,
  edge: <><path d="M22 15c-1 9-19 10-20-2C1 1 17-3 22 8c-4-5-13-3-13 3 0 6 10 9 13 4Z" fill="#087bd7" /><path d="M2 13C0 3 12-2 19 3c5 4 5 10 0 12-6 3-14-2-9-6-4 1-6 2-8 4Z" fill="#20bb9c" /><path d="M8 12c1 6 10 7 14 3-4 7-15 4-14-3Z" fill="#075d9d" /></>,
  safari: <><circle cx="12" cy="12" r="10" fill="#1e9eea" /><circle cx="12" cy="12" r="8" fill="none" stroke="#c5edff" strokeWidth=".7" strokeDasharray="1 2" /><path d="m16.8 5.2-3 8-3.6-2.4Z" fill="#ef5350" /><path d="m7.2 18.8 3-8 3.6 2.4Z" fill="#fff" /></>,
  firefox: <><circle cx="12" cy="12" r="9" fill="#7439c5" /><path d="m7 2 1 5 4-1 4-4 1 5c8 2 7 14-3 15C3 24-2 10 4 5l1 5 4-1-1 5c2 5 9 3 9-1-1 3-7 2-6-1l4-2-4-3Z" fill="#ff8a21" /><path d="M3 11c0 9 12 13 17 3-2 10-19 9-17-3Z" fill="#f6bb32" /></>,
  opera: <><ellipse cx="12" cy="12" rx="9" ry="10" fill="#e92742" /><ellipse cx="12" cy="12" rx="5" ry="7.5" fill="#fff" /><path d="M15 3c7 3 7 15 0 18 3-5 3-13 0-18Z" fill="#b61437" /></>,
  samsung: <><circle cx="12" cy="12" r="10" fill="#7660df" /><circle cx="12" cy="12" r="5" fill="#fff" /><ellipse cx="12" cy="12" rx="10" ry="3" transform="rotate(-30 12 12)" fill="none" stroke="#bcb1f8" strokeWidth="1.6" /></>,
  ie: <><path d="M19 16c-2 5-13 5-13-3 0-9 14-10 14-1v2H9v-3h7c0-3-6-3-7 1-2 5 5 6 7 3Z" fill="#16a5dc" /><ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-35 12 12)" fill="none" stroke="#f6bc28" strokeWidth="1.5" /></>,
  brave: <><path d="m6 2 3 2h6l3-2 4 7-3 9-7 4-7-4-3-9Z" fill="#f05a28" /><path d="m7 7 5-2 5 2 1 5-3 5-3 2-3-2-3-5Zm1 2 3 2-2 2m7-4-3 2 2 2m-5 2h4" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" /></>,
  vivaldi: <><rect x="2" y="2" width="20" height="20" rx="6" fill="#ef3939" /><path d="m6 7 6 11 7-11h-5l-2 4-2-4Z" fill="#fff" /></>,
  qq: <><circle cx="12" cy="11" r="9" fill="#18a8ec" /><circle cx="12" cy="11" r="5" fill="#fff" /><path d="m14 14 7 7" stroke="#18a8ec" strokeWidth="4" strokeLinecap="round" /></>,
  uc: <><circle cx="12" cy="12" r="10" fill="#f28720" /><path d="M5 9v5c0 5 6 5 6 0V9m8 1c-5-4-8 7-1 7m-2-9 3-4 2 5" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" /></>,
  yandex: <><circle cx="12" cy="12" r="10" fill="#f5f5f5" /><path d="m6 5 6 8 6-8m-6 8v7" fill="none" stroke="#f33" strokeWidth="3" strokeLinejoin="round" /></>,
  genericSystem: <><rect x="2" y="3" width="20" height="14" rx="2" fill="#5381b6" /><rect x="4" y="5" width="16" height="10" rx="1" fill="#dceafa" /><path d="M12 17v4m-5 0h10" stroke="#5381b6" strokeWidth="2" strokeLinecap="round" /></>,
  genericBrowser: <><circle cx="12" cy="12" r="10" fill="#168eaa" /><ellipse cx="12" cy="12" rx="4.5" ry="10" fill="none" stroke="#fff" strokeWidth="1.4" /><path d="M2 12h20M4 6h16M4 18h16" stroke="#fff" strokeWidth="1.2" /></>,
} satisfies Record<string, ReactNode>

type IconName = keyof typeof icons
type IconRule = readonly [RegExp, IconName]
const systemRules: readonly IconRule[] = [
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
  [/^(?:kylin|openkylin|麒麟)/u, 'kylin'], [/^openbsd\b/, 'openbsd'], [/^netbsd\b/, 'netbsd'], [/^(?:freebsd|bsd)\b/, 'bsd'],
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
  const rules = kind === 'system' ? systemRules : browserRules
  const icon = rules.find(([pattern]) => pattern.test(name.trim().toLowerCase()))?.[1] ?? (kind === 'system' ? 'genericSystem' : 'genericBrowser')
  return <svg className="comment-device-icon" data-device-icon={icon} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">{icons[icon]}</svg>
}
