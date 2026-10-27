import { EventType } from '@ag-ui/core'
import { EventSchema } from '@ag-ui/core/schemas'
import { EventSourceParserStream } from 'eventsource-parser/stream'

import type { AiActionProposal, AiGenerationMetrics, AiToolCall } from './api'
import type { BillingOperation } from '../features/billing/api'

export class AiChatRunTerminalError extends Error {}

export interface AiRunStreamHandlers {
  onBilling?: (billing: BillingOperation | null) => void
  onSnapshot: (content: string, sequence: number) => void
  onToken: (content: string, sequence: number) => void
  onMetrics?: (metrics: AiGenerationMetrics | null) => void
  onProposals?: (proposals: AiActionProposal[]) => void
  onToolCalls?: (calls: AiToolCall[]) => void
}

interface GenesisRunState {
  sequence: number
  billing: BillingOperation | null
  metrics: AiGenerationMetrics | null
  proposals: AiActionProposal[]
  tool_calls: AiToolCall[]
}

/** 复用 SSE 解析器与官方协议校验，业务投影沿用现有 UI 回调。 */
export async function consumeAgUiStream(
  response: Response,
  runId: string,
  handlers: AiRunStreamHandlers,
  signal?: AbortSignal,
): Promise<'completed' | 'disconnected'> {
  const reader = response.body!
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader()
  const abort = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    if (signal?.aborted) throw new DOMException('消息订阅已停止', 'AbortError')
    while (true) {
      const { done, value } = await reader.read()
      if (signal?.aborted) throw new DOMException('消息订阅已停止', 'AbortError')
      if (done) return 'disconnected'
      const event = EventSchema.parse(JSON.parse(value.data) as unknown)
      const metadata = event.metadata?.genesis as { sequence?: number } | undefined
      const sequence = metadata?.sequence ?? 0
      switch (event.type) {
        case EventType.RUN_STARTED:
          if (event.runId !== runId) throw new AiChatRunTerminalError('消息流任务标识不匹配')
          break
        case EventType.MESSAGES_SNAPSHOT: {
          const message = event.messages.find(item => item.id === `${runId}:assistant`)
          handlers.onSnapshot(typeof message?.content === 'string' ? message.content : '', sequence)
          break
        }
        case EventType.TEXT_MESSAGE_CONTENT:
          if (event.messageId === `${runId}:assistant`) handlers.onToken(event.delta, sequence)
          break
        case EventType.STATE_SNAPSHOT: {
          const state = (event.snapshot as { genesis?: GenesisRunState }).genesis
          if (!state) break
          handlers.onMetrics?.(state.metrics)
          handlers.onBilling?.(state.billing)
          handlers.onProposals?.(state.proposals)
          handlers.onToolCalls?.(state.tool_calls)
          break
        }
        case EventType.RUN_ERROR:
          throw new AiChatRunTerminalError(event.message)
        case EventType.RUN_FINISHED:
          if (event.runId !== runId) throw new AiChatRunTerminalError('消息流任务标识不匹配')
          return 'completed'
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    // 终态、异常、取消都释放订阅，不调用后台任务取消接口。
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
