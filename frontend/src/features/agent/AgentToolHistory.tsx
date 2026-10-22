import './AgentToolHistory.css'

import { Check, ChevronRight, CircleDashed, CirclePause, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { AiActionProposal, AiToolCall } from '../../lib/api'

const statusLabels = {
  running: '执行中', succeeded: '已完成', failed: '失败',
  awaiting_confirmation: '待确认', interrupted: '已中断',
}

function durationLabel(milliseconds: number | null) {
  if (milliseconds === null) return null
  const seconds = milliseconds / 1000
  return seconds < 60 ? `${seconds.toFixed(1)} 秒` : `${Math.floor(seconds / 60)} 分 ${(seconds % 60).toFixed(1)} 秒`
}

function StatusIcon({ status }: { status: AiToolCall['status'] }) {
  const Icon = status === 'running' ? LoaderCircle : status === 'succeeded' ? Check
    : status === 'failed' ? TriangleAlert : status === 'awaiting_confirmation' ? CirclePause : CircleDashed
  return <Icon className={status === 'running' ? 'agent-tool-history__spinner' : undefined} aria-hidden="true" />
}

export function AgentToolHistory({ calls, proposals = [], executedProposals = [], streaming = false }: {
  calls: AiToolCall[]
  proposals?: AiActionProposal[]
  executedProposals?: string[]
  streaming?: boolean
}) {
  if (!calls.length) return null
  const visible = calls.map(call => {
    const executed = call.proposal_id && (executedProposals.includes(call.proposal_id)
      || proposals.some(proposal => proposal.proposal_id === call.proposal_id && proposal.executed))
    if (call.status === 'awaiting_confirmation' && executed) {
      return { ...call, status: 'succeeded' as const, result_summary: '操作已执行' }
    }
    // 离线恢复或终态缺少结束回调时，不能让旧记录永久显示正在执行。
    return call.status === 'running' && !streaming ? { ...call, status: 'interrupted' as const } : call
  })
  const running = visible.filter(call => call.status === 'running')
  const failed = visible.filter(call => call.status === 'failed').length
  const interrupted = visible.filter(call => call.status === 'interrupted').length
  const waiting = visible.filter(call => call.status === 'awaiting_confirmation').length
  const status = running.length ? 'running' : failed ? 'failed' : interrupted ? 'interrupted'
    : waiting ? 'awaiting_confirmation' : 'succeeded'
  const summary = running.length ? `正在${running.at(-1)!.label}…`
    : `调用了 ${visible.length} 个工具`
  const state = running.length ? `${running.length} 项执行中`
    : failed ? `${failed} 项失败` : interrupted ? `${interrupted} 项中断`
      : waiting ? `${waiting} 项待确认` : '全部完成'

  return <details className={`agent-tool-history${failed || interrupted ? ' has-issues' : ''}`}>
    <summary className="agent-tool-history__summary">
      <StatusIcon status={status} /><span className="agent-tool-history__label">{summary}</span>
      <span className="agent-tool-history__state" role="status">{state}</span>
      <ChevronRight className="agent-tool-history__chevron" aria-hidden="true" />
    </summary>
    <ol className="agent-tool-history__list" aria-label="工具调用记录">
      {visible.map(call => <li key={call.id}>
        <details className="agent-tool-history__call">
          <summary>
            <StatusIcon status={call.status} /><span className="agent-tool-history__label">{call.label}</span>
            <span className="agent-tool-history__state">{statusLabels[call.status]}</span>
            {call.duration_ms !== null && <span className="agent-tool-history__duration">{durationLabel(call.duration_ms)}</span>}
            <ChevronRight className="agent-tool-history__chevron" aria-hidden="true" />
          </summary>
          <dl className="agent-tool-history__detail">
            <div><dt>工具</dt><dd><code>{call.name}</code></dd></div>
            <div><dt>输入</dt><dd>{call.input_summary}{call.parameter_names.length > 0 && <span className="agent-tool-history__parameters">{call.parameter_names.join('、')}</span>}</dd></div>
            <div><dt>结果</dt><dd>{call.status === 'running' ? '等待工具返回…' : call.status === 'interrupted' ? '调用已中断，实际结果请以业务记录为准。' : call.result_summary ?? statusLabels[call.status]}</dd></div>
          </dl>
        </details>
      </li>)}
    </ol>
  </details>
}
