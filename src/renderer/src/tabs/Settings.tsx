import { useEffect, useState } from 'react'
import { AiConnect } from '../components/AiConnect'
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

      <YourAI status={status} />

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

// Conductor-style harness section: pick your AI (Claude / ChatGPT via their
// CLIs), see the signed-in account, sign in via the CLI's native login, and
// override the executable path when auto-detection misses.
function YourAI({ status }: { status: SystemStatus }): JSX.Element {
  const [paths, setPaths] = useState<{ claudeBin: string; codexBin: string }>({ claudeBin: '', codexBin: '' })
  const [remount, setRemount] = useState(0)

  useEffect(() => {
    void window.pgp.getSettings().then((s) => setPaths({ claudeBin: s.claudeBin ?? '', codexBin: s.codexBin ?? '' }))
  }, [])

  const savePaths = (): void => {
    void window.pgp
      .setSettings({ claudeBin: paths.claudeBin.trim() || null, codexBin: paths.codexBin.trim() || null })
      .then(() => {
        setRemount((r) => r + 1)
        void status.refresh()
      })
  }

  return (
    <section className="card">
      <h2>Your AI</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Your plan, an API key, or a free local model — pick one; switch any time. Nothing leaves your machine.
      </p>
      <AiConnect key={remount} onStatus={() => void status.refresh()} />
      <details className="proj-disclaimers">
        <summary>Advanced: executable paths</summary>
        <p className="muted small">
          Leave empty to auto-detect. Set a full path if your CLI lives somewhere unusual.
        </p>
        <div className="ask-row">
          <input
            className="input"
            placeholder="/opt/homebrew/bin/claude"
            value={paths.claudeBin}
            onChange={(e) => setPaths((p) => ({ ...p, claudeBin: e.target.value }))}
          />
          <input
            className="input"
            placeholder="~/.local/bin/codex"
            value={paths.codexBin}
            onChange={(e) => setPaths((p) => ({ ...p, codexBin: e.target.value }))}
          />
          <button className="btn" onClick={savePaths}>
            Save
          </button>
        </div>
      </details>
    </section>
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
