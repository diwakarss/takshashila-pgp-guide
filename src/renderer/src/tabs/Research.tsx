import { useEffect, useRef, useState } from 'react'
import { Search, ExternalLink, Users, Scale, Table2, Clock } from 'lucide-react'
import { Md, toSuperscriptCitations } from '../components/Markdown'
import type { EngineStatus, LensKind, LensReply, ResearchSource, SourceType, ThreadDetail, Turn } from '../../../shared/ipc'

const LENS_BAR: { kind: LensKind; label: string; icon: typeof Users }[] = [
  { kind: 'stakeholders', label: 'Stakeholder map', icon: Users },
  { kind: 'twosides', label: 'Two sides', icon: Scale },
  { kind: 'evidence', label: 'Evidence table', icon: Table2 },
  { kind: 'timeline', label: 'Timeline', icon: Clock }
]

// Research — a web-first, policy-focused research surface. Ask any topic → a
// cited synthesis over type-graded web sources → policy follow-ups. Threaded
// like Tutor (reuses the thread store), but text-clean: no slides, no
// illustrations. Not tied to the course corpus.
export function Research(props: {
  ready: boolean
  engine: EngineStatus | null
  openThreadId: string | null
  onOpenThread: (id: string | null) => void
  onThreadsChanged: () => void
  onGoToSettings: () => void
}): JSX.Element {
  const { ready, engine, openThreadId, onOpenThread, onThreadsChanged, onGoToSettings } = props
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [pendingLens, setPendingLens] = useState<{ label: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (openThreadId == null) {
      setThread(null)
      return
    }
    void window.pgp.getThread(openThreadId).then(setThread)
  }, [openThreadId])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread, pending, pendingLens])

  const engineReady = engine?.available ?? false

  const runLens = async (question: string, lens: LensKind, context: string): Promise<void> => {
    if (!thread || busy) return
    setBusy(true)
    setError(null)
    setPendingLens({ label: LENS_BAR.find((l) => l.kind === lens)?.label ?? 'lens' })
    try {
      const res = await window.pgp.researchLens({ threadId: thread.id, question, lens, context })
      const detail = await window.pgp.getThread(res.threadId)
      setThread(detail)
      onThreadsChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setPendingLens(null)
    }
  }

  const ask = async (question: string): Promise<void> => {
    if (!question.trim() || busy) return
    setBusy(true)
    setPending(question.trim())
    setError(null)
    setQ('')
    try {
      const res = await window.pgp.askResearch({ question: question.trim(), threadId: thread?.id })
      const detail = await window.pgp.getThread(res.threadId)
      setThread(detail)
      if (openThreadId !== res.threadId) onOpenThread(res.threadId)
      onThreadsChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  if (!ready) {
    return (
      <div className="empty">
        <Search size={40} strokeWidth={1.25} className="empty-icon" style={{ color: '#b5781a' }} />
        <h2>Research is ready when your AI is</h2>
        <p className="muted">Connect your AI to research any topic from the web, with policy-grade sources.</p>
        <button className="btn primary" onClick={onGoToSettings}>
          Go to Settings
        </button>
      </div>
    )
  }

  const turns = thread?.turns ?? []
  // Follow-ups come from the last research answer (a lens turn has none).
  const lastResearch = [...turns].reverse().find((t) => t.answer.kind === 'research')
  const lastFollowups = lastResearch?.answer.kind === 'research' ? lastResearch.answer.followups : []

  return (
    <div className="tutor research">
      <div className="thread-scroll" ref={scrollRef}>
        {turns.length === 0 && !busy && (
          <div className="thread-welcome">
            <h2>Research any topic</h2>
            <p className="muted">
              Ask a research question for your assignment or capstone — I search the web and cite policy-grade
              sources.
            </p>
            <div className="starter-chips">
              {[
                'What is India’s fiscal deficit target and how is it tracked?',
                'Arguments for and against a Universal Basic Income in India',
                'How have other countries regulated gig-economy work?'
              ].map((s) => (
                <button key={s} className="chip" disabled={!engineReady} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn) => (
          <ResearchTurnView key={turn.id} turn={turn} busy={busy} onLens={runLens} />
        ))}

        {pending && (
          <div className="turn">
            <div className="turn-q">{pending}</div>
            <div className="turn-a">
              <p className="muted small thinking">Researching the web…</p>
            </div>
          </div>
        )}
        {pendingLens && (
          <div className="turn">
            <div className="turn-a">
              <p className="muted small thinking">Building {pendingLens.label}…</p>
            </div>
          </div>
        )}
        {error && <p className="banner danger">Couldn’t research that: {error}</p>}

        {lastFollowups.length > 0 && !busy && (
          <div className="followups">
            {lastFollowups.map((f) => (
              <button key={f} className="chip" onClick={() => ask(f)}>
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ask-row ask-dock">
        <input
          className="input"
          placeholder={thread ? 'Ask a follow-up…' : 'Research any topic…'}
          value={q}
          disabled={!engineReady || busy}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && q.trim() && ask(q)}
        />
        <button className="btn primary" disabled={!engineReady || busy || !q.trim()} onClick={() => ask(q)}>
          {busy ? '…' : 'Research'}
        </button>
      </div>
    </div>
  )
}

function ResearchTurnView(props: {
  turn: Turn
  busy: boolean
  onLens: (question: string, lens: LensKind, context: string) => void
}): JSX.Element {
  const { turn, busy, onLens } = props
  const a = turn.answer

  if (a.kind === 'lens') return <LensView lens={a} />

  if (a.kind !== 'research') return <></>
  return (
    <div className="turn">
      <div className="turn-q">{turn.question}</div>
      <div className="turn-a">
        <div className="answer-md">
          <Md>{toSuperscriptCitations(a.synthesis)}</Md>
        </div>
        {a.sources.length > 0 && <ResearchSources sources={a.sources} />}
        <div className="lens-bar">
          <span className="lens-bar-label">Analyse:</span>
          {LENS_BAR.map(({ kind, label, icon: Icon }) => (
            <button
              key={kind}
              className="lens-btn"
              disabled={busy}
              title={`Build a ${label.toLowerCase()} for this topic`}
              onClick={() => onLens(turn.question, kind, a.synthesis)}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function LensView({ lens }: { lens: LensReply }): JSX.Element {
  return (
    <div className="turn">
      <div className="turn-a">
        <div className="lens-card">
          <div className="lens-head">{lens.title}</div>
          {lens.intro && (
            <div className="answer-md lens-intro">
              <Md>{toSuperscriptCitations(lens.intro)}</Md>
            </div>
          )}

          {lens.sides && (
            <div className="lens-sides">
              <div className="lens-side for">
                <div className="lens-side-head">For</div>
                <ul>
                  {lens.sides.for.map((p, i) => (
                    <li key={i}>{toSuperscriptCitations(p)}</li>
                  ))}
                </ul>
              </div>
              <div className="lens-side against">
                <div className="lens-side-head">Against</div>
                <ul>
                  {lens.sides.against.map((p, i) => (
                    <li key={i}>{toSuperscriptCitations(p)}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {lens.table && (
            <div className="lens-table-wrap">
              <table className="lens-table">
                <thead>
                  <tr>
                    {lens.table.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lens.table.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci}>{toSuperscriptCitations(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {lens.sources.length > 0 && <ResearchSources sources={lens.sources} />}
        </div>
      </div>
    </div>
  )
}

const TYPE_LABEL: Record<SourceType, string> = {
  government: 'Government',
  data: 'Data',
  academic: 'Academic',
  thinktank: 'Think-tank',
  news: 'News',
  other: 'Other'
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function ResearchSources({ sources }: { sources: ResearchSource[] }): JSX.Element {
  return (
    <div className="sources">
      <span className="muted small">Sources</span>
      <ol className="source-list">
        {sources.map((s) => (
          <li key={s.n} className="source-line">
            <span className="source-num">{s.n}</span>
            <a className="source-line-title" href={s.url} target="_blank" rel="noreferrer" title={s.url}>
              {s.title}
              <ExternalLink size={12} className="source-ext" />
            </a>
            <span className={`src-badge ${s.type}`}>{TYPE_LABEL[s.type]}</span>
            <span className="source-host">
              {hostOf(s.url)}
              {s.date ? ` · ${s.date}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
