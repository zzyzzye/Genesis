const brandNames: Record<string, string> = {
  mimo: 'MiMo', gpt: 'GPT', openai: 'OpenAI', deepseek: 'DeepSeek',
}

/** 仅美化目录中的原始 ID；供应商已提供的人类可读名称保持原样。 */
export function modelDisplayName(name: string): string {
  if (/\s/.test(name) || !/[-_]/.test(name)) return name
  return name.split(/[-_]+/).map((part) => brandNames[part.toLowerCase()]
    ?? part.replace(/^[a-z]/, (letter) => letter.toUpperCase())).join(' ')
}
