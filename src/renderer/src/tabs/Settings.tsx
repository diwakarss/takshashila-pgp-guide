import { useEffect, useState } from 'react'
import { AiConnect } from '../components/AiConnect'
import type { AppInfo, AppSettings, ImportProgress } from '../../../shared/ipc'
import type { SystemStatus } from '../hooks/useSystemStatus'

// Settings — your AI, course library, privacy, setup, about.
export function Settings(props: { status: SystemStatus; onCorpusSynced: () => void }): JSX.Element {
  const { status, onCorpusSynced } = props
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

  // Explicit replay rides the #wizard route — we don't un-onboard (the
  // auto-onboard guard would instantly flip it back for anyone with a library).
  const replaySetup = (): void => {
    location.hash = '#wizard'
    location.reload()
  }

  return (
    <div className="surface">
      <header className="surface-head">
        <h1>Settings</h1>
      </header>

      <YourAI status={status} />

      <CourseLibrary status={status} onCorpusSynced={onCorpusSynced} />

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

function CourseLibrary(props: { status: SystemStatus; onCorpusSynced: () => void }): JSX.Element {
  const { status, onCorpusSynced } = props
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [synced, setSynced] = useState<string | null>(null)

  const start = (): ((p: ImportProgress) => void) => {
    setBusy(true)
    setError(null)
    setProgress(null)
    setSynced(null)
    return setProgress
  }

  const run = async (): Promise<void> => {
    const off = window.pgp.onImportProgress(start())
    try {
      await window.pgp.importCorpus()
      await status.refresh()
      onCorpusSynced()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      off()
      setBusy(false)
    }
  }

  const sync = async (): Promise<void> => {
    const off = window.pgp.onImportProgress(start())
    try {
      const r = await window.pgp.syncCorpus()
      await status.refresh()
      onCorpusSynced() // new/renamed courses appear without an app restart
      setSynced(
        r.pages > 0
          ? `${r.pages} new or updated lesson${r.pages === 1 ? '' : 's'} added.`
          : 'You already have the latest classes.'
      )
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

  // Class passphrase: gates corpus downloads from the class server. A default
  // ships baked into the app (students never type it); this field shows the
  // active value and lets it be overridden (rotation) or reset.
  const [keySaved, setKeySaved] = useState('')
  const [keyInput, setKeyInput] = useState('')
  useEffect(() => {
    void window.pgp.getSettings().then((s) => {
      setKeySaved(s.corpusKey ?? '')
      setKeyInput(s.corpusKey ?? '')
    })
  }, [])
  const keyDirty = keyInput.trim() !== keySaved
  const saveKey = async (): Promise<void> => {
    const s = await window.pgp.setSettings({ corpusKey: keyInput.trim() || null })
    setKeySaved(s.corpusKey ?? '')
    setKeyInput(s.corpusKey ?? '')
  }
  // Empty is never a valid state (the app always needs some key), so "clear"
  // means "back to the passphrase that ships in the app".
  const resetKey = async (): Promise<void> => {
    const s = await window.pgp.setSettings({ corpusKey: null })
    setKeySaved(s.corpusKey ?? '')
    setKeyInput(s.corpusKey ?? '')
  }
  const canSync = (corpus?.hasLocalCorpus ?? false) || !!keySaved

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
            {progress.index} / {progress.total} ·{' '}
            {progress.skipped ? 'checking library (already up to date)…' : progress.file}
          </p>
        </div>
      )}
      {busy && !progress && <p className="muted small">Starting… (loading the embedder)</p>}

      {!busy && (
        <div className="row gap">
          {(already || (!corpus?.hasLocalCorpus && !!keySaved)) && (
            <button className="btn primary" disabled={!canSync} onClick={sync}>
              Get latest classes
            </button>
          )}
          {corpus?.hasLocalCorpus && (
            <button className={already ? 'btn' : 'btn primary'} onClick={run}>
              {already ? 'Re-import everything' : `Import ${corpus?.fileCount ?? ''} lessons`}
            </button>
          )}
        </div>
      )}
      {!busy && (
        <>
          <div className="row gap" style={{ marginTop: 8 }}>
            <input
              className="input"
              type="text"
              placeholder="Class passphrase"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button className="btn" disabled={!keyDirty} onClick={() => void saveKey()}>
              Save
            </button>
            <button className="btn" onClick={() => void resetKey()}>
              Reset to built-in
            </button>
          </div>
          <p className="muted small">
            The class passphrase unlocks course downloads. It ships built into the app — students never type
            it. Change it only if the class announces a new one; Reset restores the built-in passphrase.
          </p>
        </>
      )}
      {!busy && (
        <p className="muted small">
          {already
            ? 'Get latest classes checks for the week’s new recordings and adds only what changed.'
            : 'Imports run on your machine the first time (a few minutes), then your brain remembers them.'}
        </p>
      )}
      {synced && <p className="banner ok">{synced}</p>}
      {error && <p className="banner danger">Sync failed: {error}</p>}
    </section>
  )
}
