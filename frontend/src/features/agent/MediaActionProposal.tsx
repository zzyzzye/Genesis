import { Check, FilePenLine } from 'lucide-react'
import type { AiActionProposal } from '../../lib/api'

/** 复用博客操作卡片的布局与状态；执行结果由服务端历史回执恢复。 */
export function MediaActionProposal({ action, executed, busy, disabled, onConfirm }: {
  action: AiActionProposal; executed: boolean; busy: boolean; disabled: boolean; onConfirm: () => void
}) {
  const generation = action.action.startsWith('submit_')
  const document = action.payload.document as { nodes?: { id: string; name?: string; text?: string }[] } | undefined
  const Icon = executed ? Check : FilePenLine
  return <section className={`studio-assistant__action-card${executed ? ' is-executed' : ''}`} aria-label={action.summary}>
    <div className="studio-assistant__action-heading"><Icon size={16} aria-hidden="true" /><span>{action.summary}</span><span className="studio-assistant__action-state">{executed ? '执行结果' : '操作确认'}</span></div>
    <p className="studio-assistant__action-hint">{executed ? generation ? '任务已提交，生成进度与结果在画布中更新。' : '操作已执行并保存。' : generation ? '确认后提交生成，可能产生费用；提交不代表生成完成。' : '确认后保存修改；画布已变化时需要重新读取并准备方案。'}</p>
    {typeof action.payload.name === 'string' && <p>新名称：{action.payload.name}</p>}
    {action.payload.acknowledge_unknown === true && <p className="studio-assistant__action-hint">上次结果未知，本次重新生成可能单独计费。</p>}
    {document?.nodes && <details className="studio-assistant__action-details"><summary>查看修改后的画布 · {document.nodes.length} 个节点</summary><div className="studio-assistant__action-preview">{document.nodes.map(node => <p key={node.id}><strong>{node.name || '未命名节点'}</strong>{node.text && <span>：{node.text}</span>}</p>)}</div></details>}
    <div className="studio-assistant__action-footer"><span>{executed ? '已完成' : busy ? '正在执行…' : '尚未执行'}</span><button type="button" disabled={disabled || busy || executed} onClick={onConfirm}>{executed ? '已完成' : busy ? '执行中…' : generation ? '确认生成' : '确认执行'}</button></div>
  </section>
}
