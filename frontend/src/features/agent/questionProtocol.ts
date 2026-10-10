type QuestionOption = { label: string; description: string; recommended: boolean }
type UserQuestion = { question: string; options: QuestionOption[] }
export type QuestionRequest = { id: string; questions: UserQuestion[] }

/** 只识别卡片生成的完整回答，普通聊天不能被误当作逐题答案。 */
export function questionAnswers(request: QuestionRequest, reply?: string): string[] | null {
  if (!reply) return null
  let remaining = reply
  const answers: string[] = []
  for (const [index, question] of request.questions.entries()) {
    const prefix = `${question.question}\n`
    if (!remaining.startsWith(prefix)) return null
    remaining = remaining.slice(prefix.length)
    const next = request.questions[index + 1]
    const end = next ? remaining.indexOf(`\n\n${next.question}\n`) : remaining.length
    if (end < 0 || !remaining.slice(0, end).trim()) return null
    answers.push(remaining.slice(0, end).trim())
    remaining = remaining.slice(end + (next ? 2 : 0))
  }
  return answers
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** 问题随回复存储；不完整的流式块暂不展示为正文或可提交卡片。 */
export function splitAgentQuestion(content: string): { text: string; request: QuestionRequest | null } {
  const marker = /```user-question\s*\n/i.exec(content)
  if (!marker) return { text: content, request: null }
  const start = marker.index + marker[0].length
  const end = content.indexOf('```', start)
  const text = (content.slice(0, marker.index) + (end < 0 ? '' : content.slice(end + 3))).trim()
  if (end < 0) return { text, request: null }
  const invalid = { text: `${text}\n\n问题选项暂时无法显示，请在聊天中补充你的需求。`.trim(), request: null }
  try {
    const data: unknown = JSON.parse(content.slice(start, end))
    if (!isRecord(data) || typeof data.id !== 'string' || !data.id
      || !Array.isArray(data.questions) || !data.questions.length || data.questions.length > 3) return invalid
    const questions: UserQuestion[] = []
    const values: unknown[] = data.questions
    for (const value of values) {
      if (!isRecord(value) || typeof value.question !== 'string' || !value.question.trim()
        || !Array.isArray(value.options) || value.options.length === 1 || value.options.length > 3) return invalid
      const options: QuestionOption[] = []
      const optionValues: unknown[] = value.options
      for (const option of optionValues) {
        if (!isRecord(option) || typeof option.label !== 'string' || !option.label.trim()
          || typeof option.description !== 'string' || !option.description.trim()) return invalid
        options.push({ label: option.label, description: option.description, recommended: option.recommended === true })
      }
      if (new Set(options.map((option) => option.label)).size !== options.length
        || options.filter((option) => option.recommended).length > 1) return invalid
      questions.push({ question: value.question, options })
    }
    return { text, request: { id: data.id, questions } }
  } catch { return invalid }
}
