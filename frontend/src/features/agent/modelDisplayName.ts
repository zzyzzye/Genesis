const brandNames: Record<string, string> = {
  mimo: 'MiMo', gpt: 'GPT', openai: 'OpenAI', deepseek: 'DeepSeek',
}

/** 仅美化目录中的原始 ID；供应商已提供的人类可读名称保持原样。 */
export function modelDisplayName(name: string): string {
  if (/\s/.test(name) || !/[-_]/.test(name)) return name
  // Claude 的次版本使用短横线分隔；日期后缀保持完整，避免误当成版本号。
  const displayId = name.replace(
    /^(claude[-_](?:(?:opus|sonnet|haiku)[-_])?\d+)[-_](\d{1,2})(?=[-_]|$)/i,
    '$1.$2',
  )
  return displayId.split(/[-_]+/).map((part) => brandNames[part.toLowerCase()]
    ?? part.replace(/^[a-z]/, (letter) => letter.toUpperCase())).join(' ')
}
