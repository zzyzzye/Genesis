export function tagColorIndex(name: string) {
  // 同名标签在公开页和管理页保持同色，搜索与排序不随机跳色。
  let hash = 0
  for (const character of name) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0
  return ((hash ^ (hash >>> 16)) >>> 0) % 6 + 1
}
