/** 真实画布、助手和 AG-UI 解码链路；API 全部隔离，不修改登录信息或真实项目。 */
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import './mediaCanvasNamesReview.css'
import { emptyDocument, type Document, type Snapshot } from '../../src/pages/media/api'
import type { MediaCanvasActions, MediaAssistantNode } from '../../src/pages/media/MediaAssistant'

if (!import.meta.env.DEV || !['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('仅用于本地浏览器验收')
const { ProjectCanvas } = await import('../../src/pages/media/ProjectCanvas')
const { MediaAssistant } = await import('../../src/pages/media/MediaAssistant')
const projectId = '22222222-2222-4222-8222-222222222222'
const userId = '77777777-7777-4777-8777-777777777777'
const nodeId = '33333333-3333-4333-8333-333333333333'
const state = new URLSearchParams(location.search).get('state')
const snapshotKey = `genesis-rename-review:${state ?? 'normal'}`
let snapshot: Snapshot = { version: 0, document: { ...emptyDocument(), nodes: state === 'empty' ? [] : [{ id: nodeId, type: 'note', name: '便签 1', asset_id: null, text: '雨夜街道开场，保留环境声。', x: 100, y: 160, width: 320, height: 220 }] } }
const stored = sessionStorage.getItem(snapshotKey)
if (stored) snapshot = JSON.parse(stored) as Snapshot
localStorage.removeItem(`genesis-media-draft:${userId}:${projectId}`)
sessionStorage.removeItem(`genesis-media-ai-conversation:${userId}`)
let run = 0, complete = false, renamed = false, failedRead = false
const reviewing = ['review', 'review-retry', 'review-document', 'readonly'].includes(state ?? '')
const resource = { module: 'media', kind: 'canvas_node_rename', id: '44444444-4444-4444-8444-444444444444', scope_id: projectId, parent_id: nodeId }
const proposal = { type: 'pending_action', module: 'media', action: 'rename_node', proposal_id: 'review-proposal', proposal_token: 'synthetic-review-token', summary: '修改节点名称', requires_confirmation: true, expires_at: '2099-01-01', payload: { project_id: projectId, node_id: nodeId, name: '雨夜开场', expected_version: 0 } }
const documentProposal = { ...proposal, action: 'edit_media_canvas', summary: '保存画布修改', payload: { project_id: projectId, expected_version: 0, document: snapshot.document } }
const originalFetch = window.fetch.bind(window)
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin)
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init)
  const path = url.pathname, method = init?.method ?? 'GET'
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
  if (path.endsWith(`/media/projects/${projectId}/canvas`)) {
    if (method === 'PUT') {
      if (body.version !== snapshot.version) return json({ detail: '画布版本冲突。' }, 409)
      snapshot = { version: snapshot.version + 1, document: body.document as Document }
      sessionStorage.setItem(snapshotKey, JSON.stringify(snapshot))
    } else if (renamed && ['retry', 'review-retry'].includes(state ?? '') && !failedRead) { failedRead = true; return json({ detail: '合成同步失败。' }, 503) }
    return json({ ...snapshot, read_only: state === 'readonly' })
  }
  if (path.endsWith('/ai/actions/confirm')) {
    snapshot = { version: snapshot.version + 1, document: { ...snapshot.document, nodes: snapshot.document.nodes.map(node => node.id === nodeId ? { ...node, name: '雨夜开场' } : node) } }
    renamed = true
    return json({ action: 'rename_node', status: 'completed', resource })
  }
  if (path.endsWith(`/media/projects/${projectId}`)) return json({ id: projectId, name: 'Agent 节点改名验收', version: snapshot.version })
  if (path.endsWith('/assets')) return json({ items: [], total: 0 })
  if (path.includes('/llm/providers/')) return json({ provider: path.split('/').at(-2), models: [{ id: 'synthetic-rename-model', name: '合成改名模型', billing_mode: 'free', context_window: 272000 }] })
  if (path.endsWith('/ai/chat/conversations')) return json(method === 'POST' ? { id: 'rename-conversation', title: '改名验收', title_source: 'manual', created_at: '', updated_at: '' } : [])
  if (path.includes('/ai/chat/conversations/')) return json({ id: 'rename-conversation', title: '改名验收', title_source: 'manual', messages: [] })
  if (path.endsWith('/ai/chat/runs') && method === 'POST') { run += 1; complete = false; return json({ id: `rename-run-${run}`, status: 'pending' }, 202) }
  if (path.endsWith('/stream')) {
    const runId = `rename-run-${run}`, messageId = `${runId}:assistant`, callId = `${runId}:tool`
    const metadata = { genesis: { run_id: runId } }
    const receipt = { module: 'media', kind: 'canvas_node_rename', id: `44444444-4444-4444-8444-${String(run).padStart(12, '0')}`, scope_id: projectId, parent_id: nodeId }
    const details = { label: '改名节点', status: 'succeeded', started_at: '2026-11-02T00:00:00Z', duration_ms: 100, input_summary: '4 项参数', parameter_names: ['project_id', 'node_id', 'name', 'expected_version'], proposal_id: null, resource: receipt }
    const stream = new ReadableStream({ start(controller) {
      const emit = (value: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`))
      emit({ type: 'RUN_STARTED', threadId: 'rename-conversation', runId })
      emit({ type: 'MESSAGES_SNAPSHOT', messages: [{ id: messageId, role: 'assistant', content: '', metadata }] })
      emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant', metadata })
      emit({ type: 'TOOL_CALL_START', toolCallId: callId, toolCallName: 'rename_node', parentMessageId: messageId, metadata: { genesis: { ...details, status: 'running', resource: null } } })
      emit({ type: 'TOOL_CALL_ARGS', toolCallId: callId, delta: '{}' })
      emit({ type: 'TOOL_CALL_END', toolCallId: callId })
      setTimeout(() => {
        if (reviewing) {
          emit({ type: 'TOOL_CALL_RESULT', toolCallId: callId, messageId: `${callId}:result`, role: 'tool', content: '已准备修改方案。', metadata: { genesis: { ...details, resource: null } } })
          if (state !== 'readonly') emit({ type: 'STATE_SNAPSHOT', snapshot: { genesis: { sequence: 1, metrics: null, billing: null, proposals: [state === 'review-document' ? documentProposal : proposal] } } })
          emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: state === 'readonly' ? '可以讨论这个镜头的节奏；只读画布不会被修改。' : '建议将便签命名为「雨夜开场」，请确认。' })
        } else if (snapshot.document.nodes.length) {
          const name = run % 2 ? '开场空镜' : '雨夜开场'
          snapshot = { version: snapshot.version + 1, document: { ...snapshot.document, nodes: snapshot.document.nodes.map(node => node.id === nodeId ? { ...node, name, ...(state === 'conflict' ? { x: 900 } : {}) } : node) } }
          sessionStorage.setItem(snapshotKey, JSON.stringify(snapshot)); renamed = true
          emit({ type: 'TOOL_CALL_RESULT', toolCallId: callId, messageId: `${callId}:result`, role: 'tool', content: '节点名称已保存。', metadata: { genesis: details } })
          emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: `已将节点改名为「${name}」，并保存到画布。` })
        } else emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: '画布中还没有可改名的节点。' })
        emit({ type: 'TEXT_MESSAGE_END', messageId })
        emit({ type: 'RUN_FINISHED', threadId: 'rename-conversation', runId })
        complete = true; controller.close()
      }, 1600)
    } })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  if (path.includes('/ai/chat/runs/')) return json({ id: `rename-run-${run}`, status: complete ? 'completed' : 'running', content: '', sequence: 1, error: null })
  return json({ detail: '验收页面不访问真实 API。' }, 503)
}

export function Review() {
  const [actions, setActions] = useState<MediaCanvasActions | null>(null)
  const [selected, setSelected] = useState<MediaAssistantNode | null>(null)
  return <MemoryRouter><div className="media-workspace"><ProjectCanvas projectId={projectId} userId={userId} onAgentActionsChange={setActions} onAgentNodeChange={setSelected} /><MediaAssistant userId={userId} attachmentsAllowed={false} page="canvas" projectId={projectId} selectedNode={selected} canvasActions={actions} /></div></MemoryRouter>
}
createRoot(document.getElementById('root')!).render(<Review />)
