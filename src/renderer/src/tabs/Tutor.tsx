import { useState } from 'react'
import { BookOpen, Bookmark } from 'lucide-react'
import type { EngineStatus, TutorAnswer } from '../../../shared/ipc'

// Tutor — the default surface. Phase 1: cited Q&A over the whole corpus. The
// course navigator (Course → LU → lesson) and capture land in Phase 2.
export function Tutor(props: {
  ready: boolean
  engine: EngineStatus | null
  onGoToSettings: () => void
}): JSX.Element {
  const { ready, engine, onGoToSettings } = props
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

  if (!ready) {
    return (
      <EmptyState
        title="Set up your course library"
        line="Import the cohort lessons once, then ask anything about the course and get cited answers."
        actionLabel="Go to Settings"
        onAction={onGoToSettings}
      />
    )
  }

  return (
    <div className="surface">
      <header className="surface-head">
        <h1>Tutor</h1>
        <p className="muted">Ask anything about the course. Every answer cites the lessons it came from.</p>
      </header>

      {!engineReady && (
        <p className="banner danger">
          Your AI ({engine?.label}) isn’t reachable right now. Check it in Settings.
        </p>
      )}

      <div className="ask-row">
        <input
          className="input"
          placeholder="e.g. why do outright bans fail in public policy?"
          value={q}
          disabled={!engineReady || busy}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canAsk && ask()}
        />
        <button className="btn primary" disabled={!canAsk} onClick={ask}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {!result && !busy && (
        <div className="starter-chips">
          {['Explain thinking in degrees', 'Why do bans fail?', 'What is state capacity?'].map((s) => (
            <button key={s} className="chip" disabled={!engineReady} onClick={() => setQ(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="banner danger">Couldn’t answer: {error}</p>}

      {result && (
        <article className="answer">
          <p className="answer-text">{result.answer}</p>
          {result.sources.length > 0 && (
            <div className="sources">
              <div className="sources-head">
                <span className="muted small">Sources</span>
                <button className="chip ghost" title="Save to notebook (coming soon)" disabled>
                  <Bookmark size={14} /> Save
                </button>
              </div>
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
        </article>
      )}
    </div>
  )
}

function EmptyState(props: {
  title: string
  line: string
  actionLabel: string
  onAction: () => void
}): JSX.Element {
  return (
    <div className="empty">
      <BookOpen size={40} strokeWidth={1.25} className="empty-icon" />
      <h2>{props.title}</h2>
      <p className="muted">{props.line}</p>
      <button className="btn primary" onClick={props.onAction}>
        {props.actionLabel}
      </button>
    </div>
  )
}

function snippet(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}
