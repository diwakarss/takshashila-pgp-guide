import { useEffect, useRef, useState } from 'react'
import { BookOpen, Pencil, ChevronLeft, ChevronRight } from 'lucide-react'
import { Md, toSuperscriptCitations } from '../components/Markdown'
import type {
  CourseSummary,
  EngineStatus,
  IllustrationImage,
  IllustrationSpec,
  ThreadDetail,
  Turn,
  TutorReply
} from '../../../shared/ipc'

type IllusEntry = { status: 'drawing' | 'done' | 'error'; dataUrl?: string; error?: string; quota?: boolean }

// Tutor — a threaded conversation. The whole thread scrolls as one (turns +
// follow-ups). A concept reply is a paginated slide deck (Back/Next); a simple
// reply is plain text. The follow-up input stays docked for typing.
export function Tutor(props: {
  ready: boolean
  engine: EngineStatus | null
  courses: CourseSummary[]
  course: string
  onCourseSynced: (code: string) => void
  openThreadId: string | null
  onOpenThread: (id: string | null) => void
  onThreadsChanged: () => void
  onGoToSettings: () => void
}): JSX.Element {
  const { ready, engine, courses, course, onCourseSynced, openThreadId, onOpenThread, onThreadsChanged, onGoToSettings } =
    props
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<string | null>(null) // question shown while its answer loads
  const [error, setError] = useState<string | null>(null)
  const [illus, setIllus] = useState<Record<string, IllusEntry>>({})
  const startedIllus = useRef<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (openThreadId == null) {
      setThread(null)
      return
    }
    void window.pgp.getThread(openThreadId).then((t) => {
      setThread(t)
      if (t?.courseCode) onCourseSynced(t.courseCode)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThreadId])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread, pending])

  const engineReady = engine?.available ?? false
  const courseCode = thread?.courseCode ?? course ?? ''

  const needIllustration = (turnId: string, spec: IllustrationSpec): void => {
    const key = `${turnId}:${spec.id}`
    if (startedIllus.current.has(key)) return
    startedIllus.current.add(key)
    setIllus((p) => ({ ...p, [key]: { status: 'drawing' } }))
    window.pgp
      .generateIllustration(spec, courseCode || undefined)
      .then((img: IllustrationImage) =>
        setIllus((p) => ({
          ...p,
          [key]: img.dataUrl ? { status: 'done', dataUrl: img.dataUrl } : { status: 'error', error: img.error, quota: img.quota }
        }))
      )
      .catch((e) => setIllus((p) => ({ ...p, [key]: { status: 'error', error: String(e) } })))
  }

  const ask = async (question: string): Promise<void> => {
    if (!question.trim() || busy) return
    setBusy(true)
    setPending(question.trim())
    setError(null)
    setQ('')
    try {
      const res = await window.pgp.askTutor({
        question: question.trim(),
        courseCode: thread?.courseCode ?? (course || undefined),
        threadId: thread?.id
      })
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
        <BookOpen size={40} strokeWidth={1.25} className="empty-icon" />
        <h2>Set up your course library</h2>
        <p className="muted">Import the cohort lessons once, then pick a course and ask anything.</p>
        <button className="btn primary" onClick={onGoToSettings}>
          Go to Settings
        </button>
      </div>
    )
  }

  const courseName = courseCode ? courses.find((c) => c.code === courseCode)?.name ?? courseCode : 'all courses'
  const turns = thread?.turns ?? []
  const lastAnswer = turns.length > 0 ? turns[turns.length - 1].answer : null
  const lastFollowups = lastAnswer && lastAnswer.kind !== 'lens' ? lastAnswer.followups : []

  return (
    <div className="tutor">
      <div className="thread-scroll" ref={scrollRef}>
        {turns.length === 0 && !busy && (
          <div className="thread-welcome">
            <h2>Ask about {courseName}</h2>
            <p className="muted">I’ll teach concepts as a walkthrough, or just answer simple questions.</p>
            <div className="starter-chips">
              {['Explain thinking in degrees', 'Why do bans fail?', 'What is state capacity?'].map((s) => (
                <button key={s} className="chip" disabled={!engineReady} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} illus={illus} onNeedIllustration={needIllustration} />
        ))}

        {pending && (
          <div className="turn">
            <div className="turn-q">{pending}</div>
            <div className="turn-a">
              <p className="muted small thinking">Teaching…</p>
            </div>
          </div>
        )}
        {error && <p className="banner danger">Couldn’t answer: {error}</p>}

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
          placeholder={thread ? 'Ask a follow-up…' : `Ask about ${courseName}…`}
          value={q}
          disabled={!engineReady || busy}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && q.trim() && ask(q)}
        />
        <button className="btn primary" disabled={!engineReady || busy || !q.trim()} onClick={() => ask(q)}>
          {busy ? '…' : 'Ask'}
        </button>
      </div>
    </div>
  )
}

function TurnView(props: {
  turn: Turn
  illus: Record<string, IllusEntry>
  onNeedIllustration: (turnId: string, spec: IllustrationSpec) => void
}): JSX.Element {
  const { turn, illus, onNeedIllustration } = props
  const a = turn.answer
  const slides = a.kind === 'slides' ? a.slides : []
  const [idx, setIdx] = useState(0)
  const cur = slides[idx]

  // Resolve only the current slide's illustration (lazy — no cost for slides you don't reach).
  useEffect(() => {
    if (cur?.illustration) onNeedIllustration(turn.id, cur.illustration)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn.id, idx, cur?.illustration?.id])

  // A tutor thread only ever holds tutor replies (research has its own tab).
  if (a.kind !== 'slides' && a.kind !== 'text') return <></>

  return (
    <div className="turn">
      <div className="turn-q">{turn.question}</div>
      <div className="turn-a">
        {a.kind === 'slides' && cur ? (
          <div className="slide-card">
            <h3 className="slide-heading">{cur.heading}</h3>
            {cur.illustration && (
              <Illustration spec={cur.illustration} entry={illus[`${turn.id}:${cur.illustration.id}`]} />
            )}
            <div className="answer-md">
              <Md>{toSuperscriptCitations(cur.body)}</Md>
            </div>
            {slides.length > 1 && (
              <nav className="slide-nav">
                <button className="btn" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}>
                  <ChevronLeft size={16} /> Back
                </button>
                <span className="slide-count">
                  {idx + 1} / {slides.length}
                </span>
                <button className="btn primary" disabled={idx >= slides.length - 1} onClick={() => setIdx((i) => i + 1)}>
                  Next <ChevronRight size={16} />
                </button>
              </nav>
            )}
          </div>
        ) : (
          <div className="answer-md">
            <Md>{toSuperscriptCitations(a.text)}</Md>
          </div>
        )}
        {a.sources.length > 0 && <Sources sources={a.sources} />}
      </div>
    </div>
  )
}

function Illustration(props: { spec: IllustrationSpec; entry: IllusEntry | undefined }): JSX.Element {
  const { spec, entry } = props
  if (entry?.status === 'done' && entry.dataUrl) {
    return (
      <figure className="illustration">
        <img src={entry.dataUrl} alt={spec.title} />
        <figcaption>{spec.title}</figcaption>
      </figure>
    )
  }
  if (entry?.status === 'error') {
    return (
      <div className="illus-skel error">
        {entry.quota ? 'Illustration needs image credits (OpenAI quota reached)' : 'Couldn’t draw this one'}
      </div>
    )
  }
  return (
    <div className="illus-skel">
      <Pencil size={16} /> drawing “{spec.title}”…
    </div>
  )
}

function Sources(props: { sources: TutorReply['sources'] }): JSX.Element {
  return (
    <div className="sources">
      <span className="muted small">Drawn from these lessons</span>
      <ol className="source-list">
        {props.sources.map((h, i) => (
          <li key={h.id} className="source-line">
            <span className="source-num">{i + 1}</span>
            <span className="source-line-title">{h.title ?? h.slug}</span>
            <span className="source-chip">
              {h.courseName ?? h.type ?? 'page'} · {Math.round(h.score * 100)}%
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

