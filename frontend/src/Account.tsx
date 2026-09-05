import { type FormEvent, useEffect, useState } from 'react'

import { clearStoredAuthToken, getStoredAuthToken, storeAuthToken } from './lib/auth'

import {
  getCurrentUser,
  login,
  registerAccount,
  updateCurrentUser,
  type CurrentUser,
} from './lib/api'

type AccountState =
  | { status: 'loading' }
  | { status: 'guest'; error: string | null; mode: 'login' | 'register' }
  | { status: 'ready'; user: CurrentUser; feedback: string | null }

function AccountForm({
  mode,
  error,
  onModeChange,
  onLogin,
  onRegister,
}: {
  mode: 'login' | 'register'
  error: string | null
  onModeChange: (mode: 'login' | 'register') => void
  onLogin: (handle: string, password: string) => void
  onRegister: (handle: string, displayName: string, password: string) => void
}) {
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mode === 'login') {
      onLogin(handle, password)
      return
    }
    onRegister(handle, displayName, password)
  }

  return (
    <main className="account-shell">
      <section className="account-card" aria-labelledby="account-title">
        <a className="studio-back-link" href="/">
          <span aria-hidden="true">←</span> 返回博客首页
        </a>
        <p className="eyebrow">GENESIS / COMMUNITY</p>
        <h1 id="account-title">{mode === 'login' ? '欢迎回来' : '加入讨论'}</h1>
        <p className="account-lede">
          {mode === 'login' ? '登录后参与文章讨论，并维护你的个人资料。' : '创建账号后，即可在文章下留下你的想法。'}
        </p>
        <div className="account-tabs" role="tablist" aria-label="账户操作">
          <button
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'is-active' : ''}
            onClick={() => onModeChange('login')}
            role="tab"
            type="button"
          >
            登录
          </button>
          <button
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'is-active' : ''}
            onClick={() => onModeChange('register')}
            role="tab"
            type="button"
          >
            注册
          </button>
        </div>
        <form className="account-form" onSubmit={submit}>
          <label htmlFor="account-handle">
            <span>账号</span>
            <input
              autoComplete="username"
              id="account-handle"
              minLength={3}
              onChange={(event) => setHandle(event.currentTarget.value)}
              placeholder="3–50 位英文、数字、_ 或 -"
              required
              value={handle}
            />
          </label>
          {mode === 'register' && (
            <label htmlFor="account-display-name">
              <span>昵称</span>
              <input
                autoComplete="nickname"
                id="account-display-name"
                onChange={(event) => setDisplayName(event.currentTarget.value)}
                placeholder="评论中展示的名字"
                required
                value={displayName}
              />
            </label>
          )}
          <label htmlFor="account-password">
            <span>密码</span>
            <input
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              id="account-password"
              minLength={8}
              onChange={(event) => setPassword(event.currentTarget.value)}
              placeholder="至少 8 位"
              required
              type="password"
              value={password}
            />
          </label>
          {error && <p className="studio-form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit">
            {mode === 'login' ? '登录账户' : '创建账户'} <span aria-hidden="true">→</span>
          </button>
        </form>
      </section>
    </main>
  )
}

function Profile({ user, feedback, onLogout, onSave }: {
  user: CurrentUser
  feedback: string | null
  onLogout: () => void
  onSave: (displayName: string, bio: string, avatarUrl: string) => void
}) {
  const [displayName, setDisplayName] = useState(user.display_name)
  const [bio, setBio] = useState(user.bio)
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? '')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave(displayName, bio, avatarUrl)
  }

  return (
    <main className="account-shell">
      <section className="account-card account-card--profile" aria-labelledby="profile-title">
        <div className="account-profile-heading">
          <div className="account-avatar" aria-hidden="true">
            {user.avatar_url ? <img alt="" src={user.avatar_url} /> : user.display_name.slice(0, 1)}
          </div>
          <div>
            <p className="eyebrow">GENESIS / PROFILE</p>
            <h1 id="profile-title">{user.display_name}</h1>
            <p>@{user.handle} · {user.role === 'owner' ? '站点作者' : '社区成员'}</p>
          </div>
        </div>
        <form className="account-form" onSubmit={submit}>
          <label htmlFor="profile-display-name">
            <span>昵称</span>
            <input id="profile-display-name" onChange={(event) => setDisplayName(event.currentTarget.value)} required value={displayName} />
          </label>
          <label htmlFor="profile-bio">
            <span>个人简介</span>
            <textarea id="profile-bio" maxLength={1000} onChange={(event) => setBio(event.currentTarget.value)} placeholder="介绍一下你自己" rows={4} value={bio} />
          </label>
          <label htmlFor="profile-avatar-url">
            <span>头像地址</span>
            <input id="profile-avatar-url" onChange={(event) => setAvatarUrl(event.currentTarget.value)} placeholder="https://example.com/avatar.png" type="url" value={avatarUrl} />
          </label>
          {feedback && <p className="account-feedback" role="status">{feedback}</p>}
          <button className="primary-button" type="submit">保存资料 <span aria-hidden="true">→</span></button>
        </form>
        <button className="account-logout" onClick={onLogout} type="button">退出登录</button>
      </section>
    </main>
  )
}

export function Account() {
  const [token, setToken] = useState(() => getStoredAuthToken())
  const [state, setState] = useState<AccountState>(() =>
    getStoredAuthToken() === null
      ? { status: 'guest', mode: 'login', error: null }
      : { status: 'loading' },
  )

  useEffect(() => {
    if (token === null) return
    void getCurrentUser(token)
      .then((user) => setState({ status: 'ready', user, feedback: null }))
      .catch(() => {
        clearStoredAuthToken()
        setToken(null)
        setState({ status: 'guest', mode: 'login', error: '登录状态已过期，请重新登录。' })
      })
  }, [token])

  function setLoggedInToken(accessToken: string) {
    storeAuthToken(accessToken)
    setToken(accessToken)
  }

  function handleLogin(handle: string, password: string) {
    setState({ status: 'loading' })
    void login(handle, password)
      .then((data) => setLoggedInToken(data.access_token))
      .catch(() => setState({ status: 'guest', mode: 'login', error: '账号或密码错误，请重试。' }))
  }

  function handleRegister(handle: string, displayName: string, password: string) {
    setState({ status: 'loading' })
    void registerAccount({ handle, display_name: displayName, password })
      .then(() => login(handle, password))
      .then((data) => setLoggedInToken(data.access_token))
      .catch(() => setState({ status: 'guest', mode: 'register', error: '注册失败，请检查账号格式或稍后重试。' }))
  }

  function saveProfile(displayName: string, bio: string, avatarUrl: string) {
    if (token === null || state.status !== 'ready') return
    void updateCurrentUser(token, { display_name: displayName, bio, avatar_url: avatarUrl || null })
      .then((user) => setState({ status: 'ready', user, feedback: '个人资料已保存。' }))
      .catch(() => setState({ status: 'ready', user: state.user, feedback: '保存失败，请稍后重试。' }))
  }

  if (state.status === 'loading') return <main className="account-shell account-loading">正在加载账户…</main>
  if (state.status === 'ready') {
    return (
      <Profile
        feedback={state.feedback}
        onLogout={() => {
          clearStoredAuthToken()
          setToken(null)
          setState({ status: 'guest', mode: 'login', error: null })
        }}
        onSave={saveProfile}
        user={state.user}
      />
    )
  }
  return <AccountForm error={state.error} mode={state.mode} onLogin={handleLogin} onModeChange={(mode) => setState({ status: 'guest', mode, error: null })} onRegister={handleRegister} />
}
