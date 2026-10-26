import './Account.css'

import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, Eye, EyeOff, LoaderCircle, Upload } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { GenesisLogo } from './components/GenesisLogo'
import { AccountWorkspace } from './features/account/AccountWorkspace'
import { WalletPreview } from './features/billing/WalletBalance'
import { FpsStatusSlot } from './features/performance/FpsMonitor'
import { authTokenChangedEvent, clearStoredAuthToken, getStoredAuthToken, latestAuthToken, logoutAuthSession, storeAuthToken, studioAuthTokenKey } from './lib/auth'
import { getCurrentUser, login, registerAccount, updateCurrentUser, type CurrentUser } from './lib/api'

type AccountMode = 'login' | 'register'
type AccountState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'guest'; error: string | null; mode: AccountMode }
  | { status: 'ready'; user: CurrentUser; feedback: string | null }
type AccountField = 'handle' | 'displayName' | 'password'

function AccountLayout({ children }: { children: ReactNode }) {
  const [coverFailed, setCoverFailed] = useState(false)
  return <main className="account-shell account-auth">
    <div className="account-auth-main">
      <header className="account-auth-header">
        <Link className="account-brand" to="/" aria-label="返回 Genesis 首页"><GenesisLogo /></Link>
        <div className="fps-status-actions fps-status-actions--compact"><FpsStatusSlot /><Link className="account-header-back" to="/blog">返回博客 <ArrowUpRight size={16} /></Link></div>
      </header>
      <div className="account-auth-content">{children}</div>
      <footer className="account-auth-footer"><span>Genesis · 账户</span><Link to="/blog/studio">进入写作台 <ArrowUpRight size={15} /></Link></footer>
    </div>
    <aside className="account-auth-feature" aria-label="Genesis Journal">
      {!coverFailed && <img src="/images/blog/forest.jpg" alt="" width={1586} height={992} onError={() => setCoverFailed(true)} />}
      <div className="account-feature-brand">Genesis Journal</div>
      <div className="account-feature-copy"><h2>记录，<br />也分享。</h2><p>技术实践、产品思考与日常随笔。</p><Link to="/blog">浏览文章 <ArrowUpRight size={18} /></Link></div>
    </aside>
  </main>
}

function AccountForm({ mode, error, busy, onModeChange, onLogin, onRegister, focusLogin = false }: {
  mode: AccountMode
  error: string | null
  busy: boolean
  onModeChange: (mode: AccountMode) => void
  onLogin: (handle: string, password: string) => void
  onRegister: (handle: string, displayName: string, password: string) => void
  focusLogin?: boolean
}) {
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  // 会话恢复会暂存原页面，表单标识必须与新登录页隔离。
  const id = useId()
  const [errors, setErrors] = useState<Partial<Record<AccountField, string>>>({})
  const handleInput = useRef<HTMLInputElement>(null)
  const displayNameInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const isLogin = mode === 'login'

  function changeMode() {
    if (busy) return
    setErrors({}); setVisible(false); setPassword('')
    onModeChange(isLogin ? 'register' : 'login')
    requestAnimationFrame(() => handleInput.current?.focus())
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || composing.current) return
    const next: Partial<Record<AccountField, string>> = {}
    const name = handle.trim()
    if (!name) next.handle = '请输入账号。'
    else if (!isLogin && !/^[a-z0-9][a-z0-9_-]{2,49}$/i.test(name)) next.handle = '账号须为 3–50 位英文、数字、_ 或 -，并以英文或数字开头。'
    if (!isLogin && !displayName.trim()) next.displayName = '请输入用于展示的昵称。'
    if (!password) next.password = '请输入密码。'
    else if (!isLogin && (password.length < 8 || password.length > 128)) next.password = '密码长度须为 8–128 位。'
    setErrors(next)
    if (next.handle) { handleInput.current?.focus(); return }
    if (next.displayName) { displayNameInput.current?.focus(); return }
    if (next.password) { passwordInput.current?.focus(); return }
    setVisible(false)
    if (isLogin) onLogin(name, password)
    else onRegister(name, displayName.trim(), password)
  }

  function clearFieldError(field: AccountField) {
    setErrors(previous => ({ ...previous, [field]: undefined }))
  }

  return <AccountLayout>
    <section className="account-auth-form" aria-labelledby={`${id}-title`}>
      <div className="account-form-heading"><span className="account-form-kicker">你的 Genesis 账户</span><h1 id={`${id}-title`}>{isLogin ? '登录你的账户' : '创建你的账户'}</h1><p>{isLogin ? '参与讨论，继续你的创作。' : '留下名字，加入每一次有意思的讨论。'}</p></div>
      <form className="account-form" aria-label={isLogin ? '账户登录' : '账户注册'} aria-busy={busy} noValidate onSubmit={submit} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}>
        <div className="account-field">
          <label htmlFor={`${id}-handle`}>账号</label>
          <input ref={handleInput} autoComplete="username" autoCapitalize="none" spellCheck={false} id={`${id}-handle`} name="username" autoFocus={focusLogin} readOnly={busy} maxLength={isLogin ? undefined : 50} required value={handle} placeholder={isLogin ? '输入你的账号' : '为自己取一个账号'} aria-invalid={Boolean(errors.handle)} aria-describedby={errors.handle ? `${id}-handle-error` : !isLogin ? `${id}-handle-hint` : undefined} onChange={event => { setHandle(event.currentTarget.value); clearFieldError('handle') }} />
          <div className="account-field-help">{errors.handle ? <p id={`${id}-handle-error`} className="account-field-error">{errors.handle}</p> : !isLogin && <p id={`${id}-handle-hint`}>3–50 位英文、数字、_ 或 -，以英文或数字开头</p>}</div>
        </div>
        {!isLogin && <div className="account-field">
          <label htmlFor={`${id}-display-name`}>昵称</label>
          <input ref={displayNameInput} autoComplete="nickname" id={`${id}-display-name`} name="nickname" readOnly={busy} required maxLength={100} value={displayName} placeholder="大家怎么称呼你" aria-invalid={Boolean(errors.displayName)} aria-describedby={errors.displayName ? `${id}-display-name-error` : undefined} onChange={event => { setDisplayName(event.currentTarget.value); clearFieldError('displayName') }} />
          <div className="account-field-help">{errors.displayName && <p id={`${id}-display-name-error`} className="account-field-error">{errors.displayName}</p>}</div>
        </div>}
        <div className="account-field">
          <label htmlFor={`${id}-password`}>密码</label>
          <div className="account-password">
            <input ref={passwordInput} autoComplete={isLogin ? 'current-password' : 'new-password'} id={`${id}-password`} name="password" readOnly={busy} required maxLength={isLogin ? undefined : 128} type={visible ? 'text' : 'password'} value={password} placeholder={isLogin ? '输入你的密码' : '设置 8–128 位密码'} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? `${id}-password-error` : !isLogin ? `${id}-password-hint` : undefined} onChange={event => { setPassword(event.currentTarget.value); clearFieldError('password') }} />
            <button className="account-password-toggle" type="button" aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} disabled={busy} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div>
          <div className="account-field-help">{errors.password ? <p id={`${id}-password-error`} className="account-field-error">{errors.password}</p> : !isLogin && <p id={`${id}-password-hint`}>至少 8 位，支持粘贴和密码管理器</p>}</div>
        </div>
        <div className="account-form-message" aria-live="polite">{error && <p id={`${id}-submit-error`} role="alert">{error}</p>}</div>
        <button className="account-submit" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="account-submit-spinner" size={18} aria-hidden="true" /><span>{isLogin ? '正在登录…' : '正在创建账户…'}</span></> : <><span>{isLogin ? '进入 Genesis' : '创建并进入'}</span><ArrowRight size={18} aria-hidden="true" /></>}</button>
      </form>
      <p className="account-mode-switch">{isLogin ? '还没有账户？' : '已经有账户？'}<button type="button" disabled={busy} onClick={changeMode}>{isLogin ? '注册账户' : '返回登录'}</button></p>
    </section>
  </AccountLayout>
}

export function AccountProfile({ user, feedback, busy, onLogout, onSave }: {
  user: CurrentUser
  feedback: string | null
  busy: boolean
  onLogout: () => void
  onSave: (displayName: string, bio: string, avatarUrl: string, avatar?: File) => Promise<CurrentUser | null> | void
}) {
  const [displayName, setDisplayName] = useState(user.display_name)
  const [bio, setBio] = useState(user.bio)
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? '')
  const [selectedAvatar, setSelectedAvatar] = useState<{ file: File; preview: string } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null)
  const [errors, setErrors] = useState<Partial<Record<'displayName' | 'bio' | 'avatarUrl', string>>>({})
  const nameInput = useRef<HTMLInputElement>(null)
  const bioInput = useRef<HTMLTextAreaElement>(null)
  const avatarInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const previewAvatar = selectedAvatar?.preview ?? user.avatar_url
  useEffect(() => () => { if (selectedAvatar) URL.revokeObjectURL(selectedAvatar.preview) }, [selectedAvatar])

  function selectAvatar(file?: File) {
    if (!file || busy) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) {
      setUploadError('请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片。'); return
    }
    if (!file.size || file.size > 5 * 1024 * 1024) {
      setUploadError('请选择非空且不超过 5 MiB 的图片。'); return
    }
    setUploadError(null)
    setSelectedAvatar({ file, preview: URL.createObjectURL(file) })
    setErrors(current => ({ ...current, avatarUrl: undefined }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const next: typeof errors = {}
    if (!displayName.trim()) next.displayName = '请输入昵称。'
    else if (displayName.length > 100) next.displayName = '昵称最多 100 个字符。'
    if (bio.length > 1000) next.bio = '个人简介最多 1000 个字符。'
    if (!selectedAvatar && avatarUrl.trim() && avatarUrl.trim() !== user.avatar_url) {
      try {
        const address = new URL(avatarUrl.trim())
        if (!['https:', 'http:'].includes(address.protocol)) throw new Error('unsupported')
      } catch { next.avatarUrl = '请输入 http:// 或 https:// 开头的完整头像地址。' }
      if (avatarUrl.length > 500) next.avatarUrl = '头像地址最多 500 个字符。'
    }
    setErrors(next)
    if (next.displayName) { nameInput.current?.focus(); return }
    if (next.bio) { bioInput.current?.focus(); return }
    if (next.avatarUrl) {
      const settings = avatarInput.current?.closest('details')
      if (settings) settings.open = true
      avatarInput.current?.focus(); return
    }
    const saved = await onSave(displayName.trim(), bio.trim(), avatarUrl.trim(), selectedAvatar?.file)
    if (saved) { setAvatarUrl(saved.avatar_url ?? ''); setSelectedAvatar(null); setUploadError(null) }
  }

  return (
    <AccountWorkspace user={user} active="profile">
      <header className="account-workspace-heading"><div><h1 id="profile-title">个人资料</h1><p>管理个人信息，也照顾每一次创作。</p></div><FpsStatusSlot /></header>
      <div className="account-profile-layout">
      <section className="account-card account-card--profile" aria-labelledby="profile-title">
        <div className="account-profile-heading">
          <div className="account-avatar" aria-hidden="true">
            {previewAvatar && failedAvatar !== previewAvatar ? <img alt="" src={previewAvatar} onError={() => setFailedAvatar(previewAvatar)} /> : user.display_name.slice(0, 1)}
          </div>
          <div className="account-profile-identity">
            <h2 title={user.display_name}>{user.display_name}</h2>
            <p>@{user.handle} · {user.role === 'owner' ? '站点作者' : '社区成员'}</p>
            <div className="account-avatar-actions">
              <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={14} aria-hidden="true" />上传头像</button>
              {selectedAvatar && <button type="button" disabled={busy} onClick={() => { setSelectedAvatar(null); setUploadError(null) }}>取消选择</button>}
            </div>
            <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/avif" aria-label="选择头像图片" disabled={busy} onChange={event => { selectAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
            <p className={uploadError ? 'account-avatar-error' : 'account-avatar-hint'} role={uploadError ? 'alert' : undefined} aria-live="polite">{uploadError || (selectedAvatar ? '已选图片，保存资料后生效。' : '图片最大 5 MiB')}</p>
          </div>
        </div>
        <form className="account-form account-profile-form" aria-label="个人资料" noValidate aria-busy={busy} onSubmit={event => { void submit(event) }} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }}>
          <div className="account-field account-profile-field">
            <label htmlFor="profile-display-name">昵称</label>
            <div className="account-profile-control">
              <input ref={nameInput} id="profile-display-name" autoComplete="nickname" maxLength={100} readOnly={busy} aria-invalid={Boolean(errors.displayName)} aria-describedby={errors.displayName ? 'profile-name-error' : undefined} onChange={(event) => { setDisplayName(event.currentTarget.value); setErrors(current => ({ ...current, displayName: undefined })) }} required value={displayName} />
              <div className="account-field-help">{errors.displayName && <p id="profile-name-error" className="account-field-error" role="alert">{errors.displayName}</p>}</div>
            </div>
          </div>
          <div className="account-field account-profile-field">
            <label htmlFor="profile-bio">个人简介</label>
            <div className="account-profile-control">
              <textarea ref={bioInput} className="resize-none" id="profile-bio" readOnly={busy} aria-invalid={Boolean(errors.bio)} aria-describedby={errors.bio ? 'profile-bio-error' : undefined} maxLength={1000} onChange={(event) => { setBio(event.currentTarget.value); setErrors(current => ({ ...current, bio: undefined })) }} placeholder="介绍一下你自己" rows={4} value={bio} />
              <div className="account-field-help">{errors.bio && <p id="profile-bio-error" className="account-field-error" role="alert">{errors.bio}</p>}</div>
            </div>
          </div>
          <details className="account-avatar-settings"><summary>使用头像链接</summary><div className="account-field account-profile-field">
            <label htmlFor="profile-avatar-url">头像地址</label>
            <div className="account-profile-control">
              <input ref={avatarInput} id="profile-avatar-url" autoCapitalize="none" spellCheck={false} maxLength={500} readOnly={busy} disabled={Boolean(selectedAvatar)} aria-invalid={Boolean(errors.avatarUrl)} aria-describedby={errors.avatarUrl ? 'profile-avatar-error' : undefined} onChange={(event) => { setAvatarUrl(event.currentTarget.value); setErrors(current => ({ ...current, avatarUrl: undefined })) }} placeholder="也可以粘贴图片链接" type="url" value={selectedAvatar ? '' : avatarUrl} />
              <div className="account-field-help">{errors.avatarUrl && <p id="profile-avatar-error" className="account-field-error" role="alert">{errors.avatarUrl}</p>}</div>
            </div>
          </div></details>
          <div className="account-profile-form-footer">
            <div className="account-profile-actions">
              <button className="primary-button" type="submit" disabled={busy}>{busy && <LoaderCircle className="account-submit-spinner" size={16} aria-hidden="true" />}{busy ? '正在保存…' : '保存资料'}</button>
              <button className="account-logout" disabled={busy} onClick={onLogout} type="button">退出登录</button>
            </div>
            <div className="account-profile-feedback" role="status">{feedback && <p className="account-feedback">{feedback}</p>}</div>
          </div>
        </form>
      </section>
      <WalletPreview userId={user.id} />
      </div>
    </AccountWorkspace>
  )
}

export function Account({ onAuthenticated }: { onAuthenticated?: (user: CurrentUser) => void } = {}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('returnTo')
  const [token, setToken] = useState(() => getStoredAuthToken())
  const [state, setState] = useState<AccountState>(() => getStoredAuthToken() === null
    ? { status: 'guest', mode: 'login', error: null }
    : { status: 'loading' })
  const [submitting, setSubmitting] = useState(false)
  const [reload, setReload] = useState(0)
  const pending = useRef(false)
  const attempt = useRef(0)
  const title = state.status === 'ready' ? '个人账户 · Genesis' : state.status === 'guest' && state.mode === 'register' ? '注册 · Genesis' : '登录 · Genesis'
  useEffect(() => { document.title = title }, [title])
  useEffect(() => () => { attempt.current += 1 }, [])

  useEffect(() => {
    const sync = () => {
      const current = getStoredAuthToken()
      setToken(current)
      if (!current) setState({ status:'guest', mode:'login', error:null })
    }
    sync()
    window.addEventListener(authTokenChangedEvent, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(authTokenChangedEvent, sync); window.removeEventListener('storage', sync) }
  }, [])

  useEffect(() => {
    if (token === null || token !== getStoredAuthToken()) return
    let active = true
    void getCurrentUser(token)
      .then((user) => {
        if (!active) return
        pending.current = false; setSubmitting(false)
        if (user.role === 'owner') storeAuthToken(latestAuthToken(token), studioAuthTokenKey)
        else clearStoredAuthToken(studioAuthTokenKey)
        setState({ status: 'ready', user, feedback: null })
        if (onAuthenticated) { onAuthenticated(user); return }
        if (returnTo && (/^\/media(?:\/|$)/.test(returnTo) || /^\/blog\/studio(?:\/|$)/.test(returnTo) || /^\/articles\/[a-z0-9-]+(?:#comments)?$/.test(returnTo))) void navigate(returnTo, { replace: true })
      })
      .catch((error: unknown) => {
        if (!active) return
        pending.current = false; setSubmitting(false)
        const status = error instanceof Error && 'status' in error ? error.status : undefined
        if (status !== 401) {
          setState(current => current.status === 'ready'
            ? { ...current, feedback:'账户暂时无法读取，请稍后重试。' }
            : { status:'unavailable' })
          return
        }
        clearStoredAuthToken()
        setToken(null)
        setState({ status: 'guest', mode: 'login', error: '登录状态已过期，请重新登录。' })
      })
    return () => { active = false }
  }, [token, reload, returnTo, navigate, onAuthenticated])

  async function authenticate(mode: AccountMode, handle: string, password: string, displayName = '') {
    if (pending.current) return
    pending.current = true; setSubmitting(true)
    setState({ status: 'guest', mode, error: null })
    const current = ++attempt.current
    let registered = false
    try {
      if (mode === 'register') {
        await registerAccount({ handle, display_name: displayName, password })
        registered = true
      }
      if (current !== attempt.current) return
      const data = await login(handle, password)
      if (current !== attempt.current) return
      storeAuthToken(data.access_token)
      setToken(data.access_token)
    } catch (error) {
      if (current !== attempt.current) return
      pending.current = false; setSubmitting(false)
      const status = error instanceof Error && 'status' in error ? error.status : undefined
      const message = registered ? '账户已创建，请使用刚才的账号和密码登录。'
        : status === 429 ? '操作过于频繁，请稍后重试。'
        : error instanceof TypeError || (typeof status === 'number' && status >= 500) ? '登录服务暂时不可用，请稍后重试。'
        : mode === 'register' ? status === 409 ? '这个账号暂时无法注册，请换一个账号或直接登录。' : '注册失败，请检查账号格式或稍后重试。'
        : '账号或密码错误，请重试。'
      setState({ status: 'guest', mode: registered ? 'login' : mode, error: message })
    }
  }

  async function saveProfile(displayName: string, bio: string, avatarUrl: string, avatar?: File) {
    if (token === null || state.status !== 'ready' || pending.current) return null
    pending.current = true; setSubmitting(true)
    const current = ++attempt.current
    const data = { display_name: displayName, bio, avatar_url: avatarUrl || null }
    return (avatar ? updateCurrentUser(token, data, avatar) : updateCurrentUser(token, data))
      .then((user) => { if (current === attempt.current) { setState({ status: 'ready', user, feedback: '个人资料已保存。' }); return user } return null })
      .catch(() => { if (current === attempt.current) setState({ status: 'ready', user: state.user, feedback: '保存失败，输入已保留，请稍后重试。' }); return null })
      .finally(() => { if (current === attempt.current) { pending.current = false; setSubmitting(false) } })
  }

  if (state.status === 'loading') return <AccountLayout><div className="account-auth-loading" role="status"><LoaderCircle className="account-submit-spinner" size={24} aria-hidden="true" /><span>正在加载账户…</span></div></AccountLayout>
  if (state.status === 'unavailable') return <AccountLayout><section className="account-card">
    <p className="account-feedback" role="alert">账户暂时无法读取，请稍后重试。</p>
    <button className="account-submit" type="button" onClick={() => { setState({ status:'loading' }); setReload(current => current + 1) }}>重试</button>
  </section></AccountLayout>
  if (state.status === 'ready') return <AccountProfile feedback={state.feedback} busy={submitting} user={state.user} onSave={saveProfile} onLogout={() => {
    const authorToken = getStoredAuthToken(studioAuthTokenKey)
    void logoutAuthSession(token)
    if (authorToken && authorToken !== token) void logoutAuthSession(authorToken)
    clearStoredAuthToken(); clearStoredAuthToken(studioAuthTokenKey)
    setToken(null); setState({ status: 'guest', mode: 'login', error: null })
  }} />
  return <AccountForm focusLogin={Boolean(onAuthenticated) || searchParams.get('reason') === 'expired'} busy={submitting} error={state.error ?? (searchParams.get('reason') === 'expired' ? '登录已失效，请重新登录。' : null)} mode={state.mode} onLogin={(handle, password) => { void authenticate('login', handle, password) }} onRegister={(handle, displayName, password) => { void authenticate('register', handle, password, displayName) }} onModeChange={mode => setState({ status: 'guest', mode, error: null })} />
}
