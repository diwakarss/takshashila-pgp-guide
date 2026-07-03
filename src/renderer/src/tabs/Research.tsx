import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Search, ExternalLink, Users, Scale, Table2, Clock, BookmarkPlus } from 'lucide-react'
import { Md, toSuperscriptCitations } from '../components/Markdown'
import type {
  EngineStatus,
  LensKind,
  LensReply,
  NotebookPageSummary,
  NoteSource,
  ResearchSource,
  SourceType,
  ThreadDetail,
  Turn
} from '../../../shared/ipc'

type Capture = { text: string; sources: NoteSource[]; from: string }

const toNoteSources = (sources: ResearchSource[]): NoteSource[] =>
  sources.map((s) => ({ title: s.title, url: s.url, kind: s.type }))

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
  onCaptured: () => void
  onGoToSettings: () => void
}): JSX.Element {
  const { ready, engine, openThreadId, onOpenThread, onThreadsChanged, onCaptured, onGoToSettings } = props
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [pendingLens, setPendingLens] = useState<{ label: string } | null>(null)
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null) // which thread the pending belongs to
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Track the thread currently in view, so a slow research that finishes after
  // the user has navigated away doesn't yank them back.
  const openIdRef = useRef<string | null>(openThreadId)
  useEffect(() => {
    openIdRef.current = openThreadId
  }, [openThreadId])

  // Highlight → Notebook capture: a floating pill at the selection, then a page picker.
  const [pill, setPill] = useState<{ capture: Capture; x: number; y: number } | null>(null)
  const [picker, setPicker] = useState<Capture | null>(null)
  const [pages, setPages] = useState<NotebookPageSummary[]>([])
  const [pickPage, setPickPage] = useState<string>('') // '' = new page
  const [newTitle, setNewTitle] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const onCapture = (capture: Capture, x: number, y: number): void => setPill({ capture, x, y })

  const openPicker = (): void => {
    if (!pill) return
    setPicker(pill.capture)
    setPill(null)
    setPickPage('')
    setNewTitle('')
    void window.pgp.notebookList().then(setPages)
    window.getSelection()?.removeAllRanges()
  }

  const saveSnippet = async (): Promise<void> => {
    if (!picker) return
    const page = await window.pgp.addSnippet({
      pageId: pickPage || undefined,
      newTitle: pickPage ? undefined : newTitle,
      text: picker.text,
      sources: picker.sources,
      from: picker.from
    })
    setPicker(null)
    onCaptured()
    setToast(`Saved to “${page?.title ?? 'page'}”`)
    setTimeout(() => setToast(null), 2600)
  }

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
    setPendingThreadId(thread.id)
    try {
      const res = await window.pgp.researchLens({ threadId: thread.id, question, lens, context })
      const detail = await window.pgp.getThread(res.threadId)
      if (openIdRef.current === res.threadId) setThread(detail)
      onThreadsChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setPendingLens(null)
      setPendingThreadId(null)
    }
  }

  const ask = async (question: string): Promise<void> => {
    const text = question.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    setQ('')
    try {
      // New research → create the titled thread FIRST and switch to it, so it
      // appears in Recents immediately and the "Researching…" state lives in its
      // own thread (not bleeding over whatever else is on screen).
      let threadId = thread?.id
      if (!threadId) {
        const started = await window.pgp.researchStart(text)
        threadId = started.threadId
        setThread(await window.pgp.getThread(threadId))
        onOpenThread(threadId)
        onThreadsChanged()
      }
      setPending(text)
      setPendingThreadId(threadId)

      const res = await window.pgp.askResearch({ question: text, threadId })
      const detail = await window.pgp.getThread(res.threadId)
      if (openIdRef.current === res.threadId) setThread(detail)
      onThreadsChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setPending(null)
      setPendingThreadId(null)
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
      <div className="thread-scroll" ref={scrollRef} onMouseDown={() => setPill(null)}>
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
          <ResearchTurnView key={turn.id} turn={turn} busy={busy} onLens={runLens} onCapture={onCapture} />
        ))}

        {pending && pendingThreadId === openThreadId && (
          <div className="turn">
            <div className="turn-q">{pending}</div>
            <div className="turn-a">
              <p className="muted small thinking">Researching the web…</p>
            </div>
          </div>
        )}
        {pendingLens && pendingThreadId === openThreadId && (
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

      {pill && (
        <button
          className="capture-pill"
          style={{ left: pill.x, top: pill.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={openPicker}
        >
          <BookmarkPlus size={14} /> Add to Notebook
        </button>
      )}

      {picker && (
        <div className="capture-overlay" onMouseDown={() => setPicker(null)}>
          <div className="capture-panel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="capture-head">Add to Notebook</div>
            <blockquote className="capture-quote">{picker.text}</blockquote>
            <label className="capture-field">
              <span className="course-select-label">Page</span>
              <select value={pickPage} onChange={(e) => setPickPage(e.target.value)}>
                <option value="">➕ New page…</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            {!pickPage && (
              <input
                className="input capture-title"
                placeholder="New page title (optional)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            )}
            <div className="capture-actions">
              <button className="btn" onClick={() => setPicker(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={saveSnippet}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

// Turn a text selection inside an answer into a capture, keyed to that answer's sources.
function selectionCapture(sources: NoteSource[], from: string, onCapture: CaptureFn): (e: ReactMouseEvent) => void {
  return (e) => {
    const text = window.getSelection()?.toString().trim() ?? ''
    if (text.length < 3) return
    onCapture({ text, sources, from }, e.clientX, e.clientY)
  }
}

type CaptureFn = (capture: Capture, x: number, y: number) => void

function ResearchTurnView(props: {
  turn: Turn
  busy: boolean
  onLens: (question: string, lens: LensKind, context: string) => void
  onCapture: CaptureFn
}): JSX.Element {
  const { turn, busy, onLens, onCapture } = props
  const a = turn.answer

  if (a.kind === 'lens') return <LensView lens={a} onCapture={onCapture} />

  if (a.kind !== 'research') return <></>
  const from = `Research: ${turn.question}`
  return (
    <div className="turn">
      <div className="turn-q">{turn.question}</div>
      <div className="turn-a" onMouseUp={selectionCapture(toNoteSources(a.sources), from, onCapture)}>
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

function LensView({ lens, onCapture }: { lens: LensReply; onCapture: CaptureFn }): JSX.Element {
  return (
    <div className="turn">
      <div className="turn-a" onMouseUp={selectionCapture(toNoteSources(lens.sources), lens.title, onCapture)}>
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
