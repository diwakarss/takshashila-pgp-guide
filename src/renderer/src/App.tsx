import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, BrainStats, CorpusStatus, ImportProgress, SearchHit } from '../../shared/ipc'

// Phase 0 proof harness. Proves all four eng-review spikes in one screen you
// can click: the brain boots, the real corpus imports, the embedder runs, and
// a question returns cited lessons. Phase 1+ grows this into the real Tutor.
export function App(): JSX.Element {
  const [bridge, setBridge] = useState<'checking' | 'ok' | 'down'>('checking')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [corpus, setCorpus] = useState<CorpusStatus | null>(null)
  const [stats, setStats] = useState<BrainStats | null>(null)

  const refresh = useCallback(async () => {
    setStats(await window.pgp.brainStats())
    setCorpus(await window.pgp.corpusStatus())
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const pong = await window.pgp.ping()
        if (!alive) return
        setBridge(pong === 'pong' ? 'ok' : 'down')
        setInfo(await window.pgp.appInfo())
        await refresh()
      } catch {
        if (alive) setBridge('down')
      }
    })()
    return () => {
      alive = false
    }
  }, [refresh])

  return (
    <div className="harness">
      <header className="harness-head">
        <div className="wordmark">📖 PGP Guide</div>
        <span className="muted">Phase 0 proof harness</span>
      </header>

      <div className="grid">
        <SystemCard bridge={bridge} stats={stats} corpus={corpus} info={info} />
        <ImportCard corpus={corpus} stats={stats} onDone={refresh} />
        <AskCard ready={(stats?.chunks ?? 0) > 0} />
      </div>
    </div>
  )
}

function SystemCard(props: {
  bridge: 'checking' | 'ok' | 'down'
  stats: BrainStats | null
  corpus: CorpusStatus | null
  info: AppInfo | null
}): JSX.Element {
  const { bridge, stats, corpus, info } = props
  return (
    <section className="card">
      <h2>System</h2>
      <Row label="App ↔ brain bridge">
        {bridge === 'checking' && <span className="pill pending">checking…</span>}
        {bridge === 'ok' && <span className="pill ok">connected</span>}
        {bridge === 'down' && <span className="pill danger">down</span>}
      </Row>
      <Row label="Local brain">
        {stats ? (
          <span className="pill ok">
            {stats.pages} pages · {stats.chunks} chunks
          </span>
        ) : (
          <span className="pill pending">…</span>
        )}
      </Row>
      <Row label="Course corpus on disk">
        {corpus ? (
          corpus.hasLocalCorpus ? (
            <span className="pill ok">{corpus.fileCount} lessons</span>
          ) : (
            <span className="pill danger">not found</span>
          )
        ) : (
          <span className="pill pending">…</span>
        )}
      </Row>
      {info && (
        <p className="muted small" style={{ marginTop: 12 }}>
          Electron {info.electron} · Node {info.node} · {info.platform}
        </p>
      )}
    </section>
  )
}

function ImportCard(props: {
  corpus: CorpusStatus | null
  stats: BrainStats | null
  onDone: () => Promise<void>
}): JSX.Element {
  const { corpus, stats, onDone } = props
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
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      off()
      setBusy(false)
    }
  }

  const pct = progress ? Math.round((progress.index / progress.total) * 100) : 0
  const already = (stats?.chunks ?? 0) > 0
  const canImport = corpus?.hasLocalCorpus && !busy

  return (
    <section className="card">
      <h2>Course corpus</h2>
      <p className="muted small">
        Import the cohort lessons + transcripts into your local brain. Embeds on this
        machine the first time (downloads the model once).
      </p>

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

      {!busy && (
        <button className="btn primary" disabled={!canImport} onClick={run}>
          {already ? 'Re-import corpus' : `Import ${corpus?.fileCount ?? ''} lessons`}
        </button>
      )}
      {busy && !progress && <p className="muted small">Starting… (loading the embedder)</p>}
      {error && <p className="danger small">Import failed: {error}</p>}
    </section>
  )
}

function AskCard(props: { ready: boolean }): JSX.Element {
  const { ready } = props
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)

  const ask = async (): Promise<void> => {
    if (!q.trim()) return
    setBusy(true)
    try {
      setHits(await window.pgp.search(q.trim()))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card span-2">
      <h2>Ask the course</h2>
      {!ready && <p className="muted small">Import the corpus first, then ask anything about it.</p>}
      <div className="ask-row">
        <input
          className="input"
          placeholder="e.g. why do outright bans fail in public policy?"
          value={q}
          disabled={!ready || busy}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <button className="btn primary" disabled={!ready || busy || !q.trim()} onClick={ask}>
          {busy ? 'Searching…' : 'Ask'}
        </button>
      </div>

      {hits && hits.length === 0 && <p className="muted small">No matches found.</p>}
      {hits && hits.length > 0 && (
        <ol className="hits">
          {hits.map((h) => (
            <li key={h.id} className="hit">
              <div className="hit-head">
                <span className="hit-title">{h.title ?? h.slug}</span>
                <span className="source-chip">
                  {h.type ?? 'page'} · {Math.round(h.score * 100)}%
                </span>
              </div>
              <p className="hit-text">{snippet(h.text)}</p>
              <span className="muted small">{h.slug}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function snippet(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

function Row(props: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="status-row">
      <span className="label">{props.label}</span>
      <span className="value">{props.children}</span>
    </div>
  )
}
