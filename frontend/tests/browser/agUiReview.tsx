/** 使用真实助手组件和 AG-UI 解码链路，API 全部为合成数据，不调用模型。 */
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '../../styles/base.css'
import '../../styles/shared.css'
import { BlogAssistant } from '../../src/features/blog/agent/BlogAssistant'
import { MediaAssistant } from '../../src/pages/media/MediaAssistant'
import { accountAuthTokenKey, studioAuthTokenKey } from '../../src/lib/auth'

if (!import.meta.env.DEV || !['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('此验收页仅限本地开发环境')
const params = new URLSearchParams(location.search)
const mode = params.get('mode') ?? 'full'
const media = params.get('surface') === 'media'
const token = 'ag-ui-synthetic-review'
const userId = '11111111-1111-4111-8111-111111111111'
localStorage.setItem(media ? accountAuthTokenKey : studioAuthTokenKey, token)
const sessionKey = media ? `genesis-media-ai-conversation:${userId}` : 'genesis-blog-ai-conversation'
sessionStorage.removeItem(sessionKey)
let runNumber = 0
let connections = 0
let stopped = false
let confirmed = false
const nativeFetch = window.fetch.bind(window)
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const proposal = {
  type: 'pending_action', module: 'blog', proposal_id: 'synthetic-proposal', action: 'create_draft',
  payload: { title: 'AG-UI 验收草稿', content_markdown: '合成内容' }, summary: '创建 AG-UI 验收草稿',
  requires_confirmation: true, expires_at: '2099-01-01T00:00:00Z', proposal_token: 'synthetic-proposal-token',
}
const tool = {
  id: 'synthetic-tool', name: 'list_posts', label: '读取文章', status: 'succeeded',
  started_at: '2026-10-27T03:00:00Z', duration_ms: 120, input_summary: '无参数',
  result_summary: '返回 2 项结果', parameter_names: [], proposal_id: null,
}
const { id: toolId, name: toolName, result_summary: toolSummary, ...toolDetails } = tool
const question = '\n```user-question\n' + JSON.stringify({ id: 'synthetic-question', questions: [{ question: '文章面向谁？', options: [{ label: '入门读者', description: '补充背景', recommended: true }, { label: '专业读者', description: '讨论细节', recommended: false }] }] }) + '\n```'
const metrics = { output_tokens: 30, token_source: 'actual', output_seconds: 1, tokens_per_second: 30, first_token_seconds: 0.2, total_seconds: 1.2 }
const billing = { id: 'synthetic-bill', mode: 'free', status: 'settled', charged_amount: '0.00000000', reserved_amount: '0.00000000', currency: 'CNY', provider: 'mimo', kind: 'agent', model: 'mimo-v2.6-flash' }

window.fetch = async (input, init) => {
  const path = new URL(input instanceof Request ? input.url : String(input), location.origin).pathname
  if (!path.startsWith('/api/')) return nativeFetch(input, init)
  const method = init?.method ?? 'GET'
  if (path.includes('/llm/providers/')) return json({ models: [{ id: 'mimo-v2.6-flash', name: 'MiMo V2.6 Flash', billing_mode: 'free' }] })
  if (path.endsWith('/auth/me')) return json({ id: userId, role: 'owner', handle: 'synthetic', display_name: '合成验收账户' })
  if (path.endsWith('/ai/actions/confirm')) { confirmed = true; return json({ action: 'create_draft', status: 'draft', post_id: 'synthetic-post' }) }
  if (path.endsWith('/ai/chat/conversations')) return json(method === 'POST' ? { id: 'synthetic-conversation', title: '新对话', title_source: 'manual' } : [])
  if (path.includes('/ai/chat/conversations/')) return json({ id: 'synthetic-conversation', title: '新对话', title_source: 'manual', messages: [] })
  if (path.endsWith('/ai/chat/runs') && method === 'POST') { runNumber++; connections = 0; stopped = false; return json({ id: `run-${runNumber}`, status: 'pending' }, 202) }
  if (path.includes('/ai/chat/runs/') && method === 'DELETE') { stopped = true; return new Response(null, { status: 204 }) }
  if (path.endsWith('/stream')) {
    connections++
    const runId = `run-${runNumber}`, messageId = `${runId}:assistant`
    const reconnect = mode === 'reconnect' && connections === 1
    const showTool = ['full', 'proposal', 'reconnect', 'reset'].includes(mode)
    const restoredTools = mode === 'reconnect' && connections > 1
    const snapshotMessages = (content: string, withTools: boolean) => [
      { id: `${runId}:user`, role: 'user', content: '合成验收问题' },
      { id: messageId, role: 'assistant', content, toolCalls: withTools ? [{ id: toolId, type: 'function', function: { name: toolName, arguments: '{}' }, metadata: { genesis: toolDetails } }] : [] },
      ...(withTools ? [{ id: `${runId}:tool:${toolId}`, role: 'tool', toolCallId: toolId, content: toolSummary, metadata: { genesis: toolDetails } }] : []),
    ]
    let timer: ReturnType<typeof setTimeout> | undefined
    const body = new ReadableStream({ start(controller) {
      const emit = (data: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`))
      emit({ type: 'RUN_STARTED', threadId: 'synthetic-conversation', runId })
      emit({ type: 'MESSAGES_SNAPSHOT', messages: snapshotMessages(mode === 'reconnect' ? '恢复前正文。' : '', restoredTools) })
      emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' })
      emit({ type: 'STATE_SNAPSHOT', snapshot: { genesis: { sequence: 0, metrics: null, billing: null, proposals: [] } } })
      if (showTool && !restoredTools) {
        emit({ type: 'TOOL_CALL_START', toolCallId: toolId, toolCallName: toolName, parentMessageId: messageId, metadata: { genesis: { ...toolDetails, status: 'running', duration_ms: null } } })
        emit({ type: 'TOOL_CALL_ARGS', toolCallId: toolId, delta: '{}' })
        emit({ type: 'TOOL_CALL_END', toolCallId: toolId })
      }
      timer = setTimeout(() => {
        if (reconnect) { controller.close(); return }
        if (stopped || mode === 'error') { emit({ type: 'RUN_ERROR', message: stopped ? '生成已由用户停止。' : '合成测试：生成失败，可以继续对话。' }); controller.close(); return }
        const content = mode === 'question' && runNumber === 1 ? '请先确认读者方向。' + question
          : mode === 'question' ? '已按你的回答继续。' : mode === 'empty' ? '' : 'AG-UI 正文流已完成。'
        if (content) emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: content })
        if (showTool && !restoredTools) emit({ type: 'TOOL_CALL_RESULT', toolCallId: toolId, messageId: `${runId}:tool:${toolId}`, role: 'tool', content: toolSummary, metadata: { genesis: toolDetails } })
        if (mode === 'reset') {
          emit({ type: 'TEXT_MESSAGE_END', messageId })
          emit({ type: 'MESSAGES_SNAPSHOT', messages: snapshotMessages('重算后的正文，工具结果仍保留。', true) })
          emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' })
        }
        emit({ type: 'STATE_SNAPSHOT', snapshot: { genesis: { sequence: 1, metrics, billing,
          proposals: mode === 'proposal' ? [{ ...proposal, executed: confirmed }] : [],
        } } })
        emit({ type: 'TEXT_MESSAGE_END', messageId })
        emit({ type: 'RUN_FINISHED', threadId: 'synthetic-conversation', runId })
        controller.close()
      }, mode === 'slow' ? 30000 : 700)
    }, cancel() { clearTimeout(timer) } })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  if (path.includes('/ai/chat/runs/')) return json({ id: `run-${runNumber}`, status: stopped ? 'failed' : 'running', content: '', sequence: 1, error: stopped ? '生成已由用户停止。' : null })
  if (path.includes('/billing/')) return json({ mode: 'free', available: '0.00000000', frozen: '0.00000000', currency: 'CNY' })
  return json({ items: [], total: 0 })
}
addEventListener('pagehide', () => {
  if (localStorage.getItem(media ? accountAuthTokenKey : studioAuthTokenKey) === token) localStorage.removeItem(media ? accountAuthTokenKey : studioAuthTokenKey)
  sessionStorage.removeItem(sessionKey)
}, { once: true })
createRoot(document.getElementById('root')!).render(<MemoryRouter><main style={{ padding: 24 }}><h1>AG-UI 助手验收</h1><p>所有模型、计费与写入均为合成数据。</p>{media
  ? <MediaAssistant userId={userId} attachmentsAllowed page="projects" selectedNode={null} />
  : <BlogAssistant page={{ route: '/blog/studio/posts', section: 'posts', pageType: 'posts_list' }} editor={null} />}</main></MemoryRouter>)
