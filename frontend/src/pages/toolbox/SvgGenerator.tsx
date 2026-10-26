import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, cancelAiChatRun, createAiChatRun, getAiChatRun, getCurrentUser, streamAiChatRun, type AiChatRunSnapshot } from '../../lib/api'
import { getStoredAuthToken } from '../../lib/auth'
import { downloadBlob } from '../../lib/download'
import { safeSvg } from './svgSafety'
import './SvgGenerator.css'

function SvgPreview({ source }: { source: string }) {
  const image = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([source], { type:'image/svg+xml' }))
    if (image.current) image.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [source])
  return <img ref={image} alt="MiMo 生成的 SVG 图形" />
}

export function SvgGenerator() {
  const token = getStoredAuthToken()
  const [userId, setUserId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [source, setSource] = useState('')
  const [safe, setSafe] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<AiChatRunSnapshot | null>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [starting, setStarting] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const active = useRef(false)
  const intent = useRef<string | null>(null)
  const storageKey = userId ? `genesis-svg-run:${userId}` : ''
  const running = starting || !!runId && (!snapshot || ['pending','running'].includes(snapshot.status))
  useEffect(() => {
    if (!token) return
    let current = true
    void getCurrentUser(token).then(user => {
      if (!current) return
      setUserId(user.id)
      try {
        const previous = sessionStorage.getItem(`genesis-svg-run:${user.id}`)
        if (previous) { setRunId(previous); setPrompt(sessionStorage.getItem(`genesis-svg-prompt:${user.id}`) ?? '') }
      } catch { /* 存储不可用时仍可生成。 */ }
    }).catch((reason: Error) => { if (current) setError(reason.message) })
    return () => { current = false }
  }, [token])
  useEffect(() => {
    if (!token || !runId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function follow() {
      try {
        const state = await getAiChatRun(token!, runId!)
        if (controller.signal.aborted) return
        setSnapshot(state); setSource(state.content)
        if (state.status === 'failed') { setError(state.error || '生成未完成，请检查保留的源码或重新生成。'); return }
        if (state.status === 'completed') {
          try { setSafe(safeSvg(state.content)); setError('') } catch (reason) { setError((reason as Error).message); setSafe('') }
          return
        }
        await streamAiChatRun(token!, runId!, {
          onSnapshot: text => setSource(text), onToken: text => setSource(value => value+text),
        }, controller.signal)
        if (!controller.signal.aborted) timer = setTimeout(() => { void follow() }, 500)
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError((reason as Error).message)
          // SSE 终态错误仍要读取任务快照，以恢复停止或失败状态。
          const state = await getAiChatRun(token!, runId!).catch(() => null)
          if (controller.signal.aborted) return
          if (state) { setSnapshot(state); setSource(state.content) }
          if (!state || ['pending','running'].includes(state.status)) timer = setTimeout(() => { void follow() }, 3000)
        }
      }
    }
    void follow()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [token, runId, attempt])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !userId || active.current || running || !prompt.trim()) return
    active.current = true; setStarting(true); setError(''); setFeedback('')
    intent.current ??= crypto.randomUUID()
    try { sessionStorage.setItem(`genesis-svg-prompt:${userId}`, prompt.trim()) } catch { /* 不影响提交。 */ }
    try {
      const run = await createAiChatRun(token, { surface:'toolbox',purpose:'svg',request_id:intent.current,messages:[{ role:'user',content:prompt.trim() }] })
      setRunId(run.id); setSnapshot(null); setSource(''); setSafe(''); intent.current = null
      try { sessionStorage.setItem(storageKey, run.id) } catch { /* 不影响当前流式生成。 */ }
    } catch (reason) {
      if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500) intent.current = null
      setError((reason as Error).message)
    }
    finally { active.current = false; setStarting(false) }
  }
  async function stop() {
    if (!token || !runId) return
    try { await cancelAiChatRun(token, runId); setAttempt(n => n+1) }
    catch (reason) { setError((reason as Error).message) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(safe); setFeedback('安全 SVG 源码已复制') }
    catch { setFeedback('复制失败，请使用源码区手动选择复制。') }
  }
  return <main className="svg-page">
    <header><Link to="/toolbox">← 工具箱</Link><Link to="/account/wallet">账户与钱包</Link></header>
    <div className="svg-heading"><span>MiMo · 免费</span><h1>把想法画成 SVG。</h1><p>描述图标、插画或小图表，生成可预览、复制和下载的矢量图。登录后免费使用，不消耗钱包余额。</p></div>
    {!token ? <p><Link to="/account">登录后开始生成</Link></p> : <form onSubmit={event => void submit(event)} noValidate>
      <label htmlFor="svg-description">画面描述</label><textarea className="resize-none" id="svg-description" rows={3} maxLength={6000} value={prompt} readOnly={running} onChange={e => { setPrompt(e.target.value); if (!error) intent.current = null }} placeholder="例如：画一只趴在月亮上的猫，深蓝与暖黄色，适合作为网站插画。" />
      <div className="svg-actions"><span>不限每日次数 · 每次最多 4,096 token · 同时一个 MiMo 任务</span>{running ? <button type="button" onClick={() => void stop()} disabled={starting}>停止生成</button> : <button type="submit" disabled={!userId || !prompt.trim() || starting}>{snapshot ? '重新生成 SVG' : '免费生成 SVG'}</button>}</div>
    </form>}
    <div className="svg-feedback" aria-live="polite">{running && <p role="status">正在生成 SVG，可离开后返回继续查看。</p>}{error && <p role="alert">{error} {runId && <button type="button" onClick={() => setAttempt(n => n+1)}>刷新任务状态</button>}</p>}{feedback && <p role="status">{feedback}</p>}</div>
    <section className="svg-workspace" aria-label="SVG 生成结果">
      <div className="svg-preview"><h2>预览</h2>{safe ? <SvgPreview source={safe} /> : <p>{running ? '生成完整 SVG 后显示预览' : '你的矢量图会显示在这里'}</p>}</div>
      <div className="svg-source"><div className="svg-actions"><h2>{safe ? '安全源码' : '生成源码'}</h2><div><button type="button" disabled={!safe} onClick={() => void copy()}>复制 SVG</button><button type="button" disabled={!safe} onClick={() => downloadBlob(new Blob([safe], { type:'image/svg+xml' }), 'genesis.svg')}>下载 SVG</button></div></div><pre tabIndex={0} aria-label="SVG 源码"><code>{safe || source || '<svg>…</svg>'}</code></pre></div>
    </section>
  </main>
}
