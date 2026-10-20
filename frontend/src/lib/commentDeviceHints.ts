export interface CommentDeviceHints {
  platform: string
  platform_version?: string
  full_version_list: { brand: string; version: string }[]
}

interface CommentUAData {
  platform?: string
  getHighEntropyValues?: (keys: string[]) => Promise<{
    platformVersion?: string
    fullVersionList?: { brand: string; version: string }[]
  }>
}

const knownBrands = new Set(['Microsoft Edge', 'Opera', 'Brave', 'Vivaldi', 'Samsung Internet', 'Google Chrome', 'Chromium'])
const numericVersion = /^\d{1,6}(?:\.\d{1,6}){0,3}$/

// 只在提交时读取两个版本字段；拒绝、超时或不支持均不影响评论提交。
export async function collectCommentDeviceHints(): Promise<CommentDeviceHints | undefined> {
  const data = (navigator as Navigator & { userAgentData?: CommentUAData }).userAgentData
  if (!data?.getHighEntropyValues) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      data.getHighEntropyValues(['platformVersion', 'fullVersionList']),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 400) }),
    ])
    if (!result) return undefined
    const versions = Array.isArray(result.fullVersionList) ? result.fullVersionList : []
    return {
      platform: typeof data.platform === 'string' ? data.platform.slice(0, 32) : '',
      ...(typeof result.platformVersion === 'string' && numericVersion.test(result.platformVersion) ? { platform_version: result.platformVersion } : {}),
      full_version_list: versions.filter(item => item && knownBrands.has(item.brand) && typeof item.version === 'string' && numericVersion.test(item.version)).slice(0, 8).map(({ brand, version }) => ({ brand, version })),
    }
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
