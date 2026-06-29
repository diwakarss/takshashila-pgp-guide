import { useEffect, useState } from 'react'
import type { AppInfo } from '../../shared/ipc'

// Phase 0 proof-harness home. Right now it verifies the spine is alive:
// the renderer can reach the main process across the sandbox bridge and
// read runtime info. Each Phase 0 step adds a panel below (brain status,
// corpus import, query box) until this screen proves all four spikes.
export function App(): JSX.Element {
  const [bridge, setBridge] = useState<'checking' | 'ok' | 'down'>('checking')
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const pong = await window.pgp.ping()
        const appInfo = await window.pgp.appInfo()
        if (!alive) return
        setBridge(pong === 'pong' ? 'ok' : 'down')
        setInfo(appInfo)
      } catch {
        if (alive) setBridge('down')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="app-shell">
      <div className="card">
        <div className="wordmark">📖 PGP Guide</div>
        <p style={{ color: 'var(--muted)', marginTop: 4 }}>
          Phase 0 proof harness — proving the spine before any surfaces.
        </p>

        <h2 style={{ marginTop: 24 }}>System</h2>

        <div className="status-row">
          <span className="label">App ↔ brain bridge</span>
          <span className="value">
            {bridge === 'checking' && <span className="pill pending">checking…</span>}
            {bridge === 'ok' && <span className="pill ok">connected</span>}
            {bridge === 'down' && <span className="pill" style={{ color: 'var(--danger)' }}>down</span>}
          </span>
        </div>

        <div className="status-row">
          <span className="label">Local brain (PGLite + vectors)</span>
          <span className="value">
            <span className="pill pending">next step</span>
          </span>
        </div>
        <div className="status-row">
          <span className="label">Course corpus import</span>
          <span className="value">
            <span className="pill pending">next step</span>
          </span>
        </div>
        <div className="status-row">
          <span className="label">Ask a question</span>
          <span className="value">
            <span className="pill pending">next step</span>
          </span>
        </div>

        {info && (
          <>
            <h2 style={{ marginTop: 24 }}>Runtime</h2>
            <div className="status-row">
              <span className="label">App version</span>
              <span className="value">{info.appVersion}</span>
            </div>
            <div className="status-row">
              <span className="label">Electron / Chrome</span>
              <span className="value">
                {info.electron} / {info.chrome}
              </span>
            </div>
            <div className="status-row">
              <span className="label">Node / platform</span>
              <span className="value">
                {info.node} · {info.platform}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
