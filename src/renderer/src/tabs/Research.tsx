import { useEffect, useRef, useState } from 'react'
import { Search, ExternalLink } from 'lucide-react'
import { Md, toSuperscriptCitations } from '../components/Markdown'
import type { EngineStatus, ResearchSource, SourceType, ThreadDetail, Turn } from '../../../shared/ipc'

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
  }, [thread, pending])

  const engineReady = engine?.available ?? false

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
  const lastFollowups = turns.length > 0 ? turns[turns.length - 1].answer.followups : []

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
          <ResearchTurnView key={turn.id} turn={turn} />
        ))}

        {pending && (
          <div className="turn">
            <div className="turn-q">{pending}</div>
            <div className="turn-a">
              <p className="muted small thinking">Researching the web…</p>
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

function ResearchTurnView({ turn }: { turn: Turn }): JSX.Element {
  const a = turn.answer
  if (a.kind !== 'research') return <></>
  return (
    <div className="turn">
      <div className="turn-q">{turn.question}</div>
      <div className="turn-a">
        <div className="answer-md">
          <Md>{toSuperscriptCitations(a.synthesis)}</Md>
        </div>
        {a.sources.length > 0 && <ResearchSources sources={a.sources} />}
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
