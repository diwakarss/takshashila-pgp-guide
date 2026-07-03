import { useEffect, useState } from 'react'
import type { AppInfo, AppSettings, ImportProgress } from '../../../shared/ipc'
import type { SystemStatus } from '../hooks/useSystemStatus'

// Settings — your AI, course library, privacy, setup, about.
export function Settings(props: { status: SystemStatus }): JSX.Element {
  const { status } = props
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  useEffect(() => {
    void window.pgp.appInfo().then(setInfo)
    void window.pgp.getSettings().then(setSettings)
  }, [])

  const toggleMetrics = (): void => {
    if (!settings) return
    const next = !settings.metrics
    setSettings({ ...settings, metrics: next })
    void window.pgp.setSettings({ metrics: next })
  }

  const replaySetup = (): void => {
    void window.pgp.setSettings({ onboarded: false }).then(() => location.reload())
  }

  return (
    <div className="surface">
      <header className="surface-head">
        <h1>Settings</h1>
      </header>

      <section className="card">
        <h2>Your AI</h2>
        <div className="status-row">
          <span className="label">Connected</span>
          <span>
            {status.engine ? (
              status.engine.available ? (
                <span className="pill ok">{status.engine.label}</span>
              ) : (
                <span className="pill danger">{status.engine.label} — not reachable</span>
              )
            ) : (
              <span className="pill pending">…</span>
            )}
          </span>
        </div>
        <p className="muted small">
          PGP Guide runs on your own Claude plan through the Claude Code CLI — nothing leaves your machine.
          API-key and local-model options arrive with a later update.
        </p>
      </section>

      <CourseLibrary status={status} />

      <section className="card">
        <h2>Privacy</h2>
        <div className="status-row">
          <span className="label">Anonymous usage metrics</span>
          <button
            className={`pill ${settings?.metrics ? 'ok' : 'pending'}`}
            style={{ cursor: 'pointer' }}
            onClick={toggleMetrics}
          >
            {settings ? (settings.metrics ? 'On' : 'Off') : '…'}
          </button>
        </div>
        <p className="muted small">
          Everything stays on your computer. Metrics never include your questions, notes, or name — just a
          signal that the app is being used. Toggle it off any time.
        </p>
      </section>

      <section className="card">
        <h2>Setup</h2>
        <div className="status-row">
          <span className="label">First-run setup</span>
          <button className="btn" onClick={replaySetup}>
            Replay setup
          </button>
        </div>
        <p className="muted small">Re-run the welcome + connect-AI + import walkthrough.</p>
      </section>

      <section className="card">
        <h2>About</h2>
        <div className="status-row">
          <span className="label">Version</span>
          <span className="value">{info?.appVersion ?? '…'}</span>
        </div>
        {info && (
          <p className="muted small">
            Electron {info.electron} · Node {info.node} · {info.platform}
          </p>
        )}
      </section>
    </div>
  )
}

function CourseLibrary(props: { status: SystemStatus }): JSX.Element {
  const { status } = props
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress(null)
    const off = window.pgp.onImportProgress((p) => setProgress(p))
    try {
      await window.pgp.importCorpus()
      await status.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      off()
      setBusy(false)
    }
  }

  const corpus = status.corpus
  const already = (status.stats?.chunks ?? 0) > 0
  const pct = progress ? Math.round((progress.index / progress.total) * 100) : 0

  return (
    <section className="card">
      <h2>Course library</h2>
      <div className="status-row">
        <span className="label">Lessons available</span>
        <span className="value">{corpus?.hasLocalCorpus ? `${corpus.fileCount}` : 'none found'}</span>
      </div>
      <div className="status-row">
        <span className="label">In your brain</span>
        <span className="value">
          {status.stats ? `${status.stats.pages} lessons · ${status.stats.chunks} passages` : '…'}
        </span>
      </div>

      {busy && progress && (
        <div className="progress-wrap">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="muted small">
            {progress.index} / {progress.total} · {progress.file}
          </p>
        </div>
      )}
      {busy && !progress && <p className="muted small">Starting… (loading the embedder)</p>}

      {!busy && (
        <button className="btn primary" disabled={!corpus?.hasLocalCorpus} onClick={run}>
          {already ? 'Re-import lessons' : `Import ${corpus?.fileCount ?? ''} lessons`}
        </button>
      )}
      {!busy && (
        <p className="muted small">
          Imports run on your machine the first time (a few minutes), then your brain remembers them.
        </p>
      )}
      {error && <p className="banner danger">Import failed: {error}</p>}
    </section>
  )
}
