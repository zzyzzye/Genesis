import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CommentSource } from '../src/features/blog/CommentSource'
import type { BlogComment } from '../src/lib/api'

const comment: BlogComment = { id: 'source-test', author_name: '访客', content: '测试评论', created_at: '2026-10-20T00:00:00Z' }
afterEach(cleanup)

it.each([
  ['Windows', 'windows'], ['Windows Phone', 'windows'], ['Mac OS X', 'macos'], ['macOS', 'macos'],
  ['Windows 7', 'windows7'], ['Windows 10', 'windows10'], ['Windows 11', 'windows11'],
  ['Windows 8.1', 'windows10'], ['Windows（版本未知）', 'windows'],
  ['macOS 15.3.1', 'macos'], ['Android 15', 'android'], ['iOS 18.1.1', 'ios'], ['Ubuntu 24.04', 'ubuntu'],
  ['iOS', 'ios'], ['iPadOS', 'ios'], ['Android', 'android'], ['Linux', 'linux'], ['Chrome OS', 'chromeos'],
  ['HarmonyOS', 'harmony'], ['鸿蒙', 'harmony'], ['Ubuntu', 'ubuntu'], ['Debian', 'debian'], ['Fedora', 'fedora'],
  ['Arch Linux', 'arch'], ['CentOS', 'centos'], ['openSUSE', 'suse'], ['Linux Mint', 'mint'], ['Deepin', 'deepin'],
  ['Kali Linux', 'kali'], ['Kylin', 'genericSystem'], ['FreeBSD', 'bsd'], ['OpenBSD', 'openbsd'], ['NetBSD', 'netbsd'],
  ['Tizen', 'tizen'], ['webOS', 'webos'], ['KaiOS', 'kaios'], ['BlackBerry OS', 'blackberry'], ['Symbian OS', 'symbian'],
])('操作系统 %s 使用对应图标，保留原名称', (name, icon) => {
  const { container } = render(<CommentSource item={{ ...comment, operating_system: name }} />)
  expect(screen.getByText(name)).toBeInTheDocument()
  expect(container.querySelector('[data-device-icon]')).toHaveAttribute('data-device-icon', icon)
  expect(container.querySelector('[data-device-icon]')).toHaveAttribute('aria-hidden', 'true')
})

it.each([
  ['Chrome', 'chrome'], ['Chrome Mobile iOS', 'chrome'], ['Chromium', 'chromium'], ['Edge Mobile', 'edge'],
  ['Chrome 132.0.6834.110', 'chrome'], ['Edge 132.0.2957.127', 'edge'], ['Mobile Safari 18.1', 'safari'],
  ['Safari', 'safari'], ['Mobile Safari', 'safari'], ['Firefox', 'firefox'], ['Firefox iOS', 'firefox'],
  ['Opera Mini', 'opera'], ['Samsung Internet', 'samsung'], ['IE', 'ie'], ['Brave', 'brave'], ['Vivaldi', 'vivaldi'],
  ['QQ Browser Mobile', 'qq'], ['UC Browser', 'uc'], ['Yandex Browser', 'yandex'],
])('浏览器 %s 使用对应图标，不把内核名称当作浏览器', (name, icon) => {
  const { container } = render(<CommentSource item={{ ...comment, browser: name }} />)
  expect(screen.getByText(name)).toBeInTheDocument()
  expect(container.querySelector('[data-device-icon]')).toHaveAttribute('data-device-icon', icon)
})

it('地区、系统和浏览器独立显示，未知名称使用通用图标', () => {
  const { container } = render(<CommentSource item={{ ...comment, region: '浙江省', operating_system: '未收录系统', browser: '定制浏览器' }} />)
  expect(screen.getByText('浙江省')).toBeInTheDocument()
  expect(screen.getByText('未收录系统')).toBeInTheDocument()
  expect(screen.getByText('定制浏览器')).toBeInTheDocument()
  expect(container.querySelector('[data-device-icon="genericSystem"]')).toBeInTheDocument()
  expect(container.querySelector('[data-device-icon="genericBrowser"]')).toBeInTheDocument()
})

it('没有设备资料时不编造信息，只有地区时不渲染设备图标', () => {
  const { container, rerender } = render(<CommentSource item={comment} />)
  expect(container).toBeEmptyDOMElement()
  rerender(<CommentSource item={{ ...comment, region: '浙江省' }} />)
  expect(screen.getByText('浙江省')).toBeInTheDocument()
  expect(container.querySelector('[data-device-icon]')).toBeNull()
})

it('本地品牌素材加载失败时回退到通用图标，保留设备与版本文字', () => {
  const { container } = render(<CommentSource item={{ ...comment, browser: 'Firefox 132.0.2' }} />)
  const asset = container.querySelector('img')!
  expect(asset).toHaveAttribute('alt', '')
  expect(asset).toHaveAttribute('draggable', 'false')
  fireEvent.error(asset)
  expect(container.querySelector('[data-device-icon="genericBrowser"]')).toBeInTheDocument()
  expect(screen.getByText('Firefox 132.0.2')).toBeInTheDocument()
})
