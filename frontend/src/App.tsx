import { useEffect, useState } from 'react'

import { getHealth, type HealthResponse } from './lib/api'

type ConnectionState =
  | { status: 'loading' }
  | { status: 'online'; data: HealthResponse }
  | { status: 'offline' }

export function App() {
  const [connection, setConnection] = useState<ConnectionState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    void getHealth(controller.signal)
      .then((data) => setConnection({ status: 'online', data }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setConnection({ status: 'offline' })
        }
      })

    return () => controller.abort()
  }, [])

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <span className="eyebrow">React · FastAPI</span>
        <h1 id="page-title">Genesis</h1>
        <p className="subtitle">工程骨架已经就绪，可以从这里开始构建产品。</p>

        <div className={`status status--${connection.status}`} role="status">
          <span className="status__dot" aria-hidden="true" />
          {connection.status === 'loading' && '正在连接后端…'}
          {connection.status === 'online' &&
            `后端服务正常 · ${connection.data.environment}`}
          {connection.status === 'offline' && '后端暂未连接，请先启动 FastAPI 服务'}
        </div>
      </section>
    </main>
  )
}
