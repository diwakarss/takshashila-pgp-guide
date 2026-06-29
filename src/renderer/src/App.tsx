import { useCallback, useEffect, useState } from 'react'
import type {
  AppInfo,
  BrainStats,
  CorpusStatus,
  EngineStatus,
  ImportProgress,
  TutorAnswer
} from '../../shared/ipc'

// Phase 0 proof harness. Proves all four eng-review spikes in one screen you
// can click: the brain boots, the real corpus imports, the embedder runs, and
// a question returns a CITED answer from your engine. Phase 1+ grows this into
// the real Tutor.
export function App(): JSX.Element {
  const [bridge, setBridge] = useState<'checking' | 'ok' | 'down'>('checking')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [corpus, setCorpus] = useState<CorpusStatus | null>(null)
  const [stats, setStats] = useState<BrainStats | null>(null)
  const [engine, setEngine] = useState<EngineStatus | null>(null)

  const refresh = useCallback(async () => {
    setStats(await window.pgp.brainStats())
    setCorpus(await window.pgp.corpusStatus())
    setEngine(await window.pgp.engineStatus())
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
        <SystemCard bridge={bridge} stats={stats} corpus={corpus} engine={engine} info={info} />
        <ImportCard corpus={corpus} stats={stats} onDone={refresh} />
        <AskCard ready={(stats?.chunks ?? 0) > 0} engine={engine} />
      </div>
    </div>
  )
}

function SystemCard(props: {
  bridge: 'checking' | 'ok' | 'down'
  stats: BrainStats | null
  corpus: CorpusStatus | null
  engine: EngineStatus | null
  info: AppInfo | null
}): JSX.Element {
  const { bridge, stats, corpus, engine, info } = props
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
      <Row label="AI engine">
        {engine ? (
          engine.available ? (
            <span className="pill ok">{engine.label}</span>
          ) : (
            <span className="pill danger">{engine.label} — not found</span>
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
        machine the first time — a few minutes, one time only.
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

function AskCard(props: { ready: boolean; engine: EngineStatus | null }): JSX.Element {
  const { ready, engine } = props
  const [q, setQ] = useState('')
  const [result, setResult] = useState<TutorAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const engineReady = engine?.available ?? false
  const canAsk = ready && engineReady && !busy && q.trim().length > 0

  const ask = async (): Promise<void> => {
    if (!q.trim()) return
    setBusy(true)
    setError(null)
    try {
      setResult(await window.pgp.askTutor(q.trim()))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card span-2">
      <h2>Ask the course</h2>
      {!ready && <p className="muted small">Import the corpus first, then ask anything about it.</p>}
      {ready && !engineReady && (
        <p className="danger small">
          Your AI engine ({engine?.label}) isn’t reachable. In dev, launch from a terminal where
          `claude` is on your PATH.
        </p>
      )}
      <div className="ask-row">
        <input
          className="input"
          placeholder="e.g. why do outright bans fail in public policy?"
          value={q}
          disabled={!ready || !engineReady || busy}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canAsk && ask()}
        />
        <button className="btn primary" disabled={!canAsk} onClick={ask}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {error && <p className="danger small">Couldn’t answer: {error}</p>}

      {result && (
        <div className="answer">
          <p className="answer-text">{result.answer}</p>
          {result.sources.length > 0 && (
            <div className="sources">
              <span className="muted small">Sources</span>
              <ol className="hits">
                {result.sources.map((h, i) => (
                  <li key={h.id} className="hit">
                    <div className="hit-head">
                      <span className="hit-title">
                        [{i + 1}] {h.title ?? h.slug}
                      </span>
                      <span className="source-chip">
                        {h.type ?? 'page'} · {Math.round(h.score * 100)}%
                      </span>
                    </div>
                    <p className="hit-text">{snippet(h.text)}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function snippet(text: string, max = 240): string {
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
