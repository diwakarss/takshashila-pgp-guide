import { useEffect, useRef, useState } from 'react'
import { BookOpen, Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type {
  CourseSummary,
  EngineStatus,
  IllustrationImage,
  IllustrationSpec,
  Slide,
  ThreadDetail,
  Turn,
  TutorReply
} from '../../../shared/ipc'

type IllusEntry = { status: 'drawing' | 'done' | 'error'; dataUrl?: string; error?: string; quota?: boolean }

// Tutor — a threaded conversation rendered like a chat: every turn (question +
// reply) stacked and scrollable, with the follow-up box docked at the bottom.
// Concept replies render their slides inline; simple replies render as text.
export function Tutor(props: {
  ready: boolean
  engine: EngineStatus | null
  openThreadId: string | null
  onOpenThread: (id: string | null) => void
  onThreadsChanged: () => void
  onGoToSettings: () => void
}): JSX.Element {
  const { ready, engine, openThreadId, onOpenThread, onThreadsChanged, onGoToSettings } = props
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [course, setCourse] = useState<string>('')
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [illus, setIllus] = useState<Record<string, IllusEntry>>({})
  const startedIllus = useRef<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ready) void window.pgp.courses().then(setCourses)
  }, [ready])

  // Load (or clear) the open thread.
  useEffect(() => {
    if (openThreadId == null) {
      setThread(null)
      return
    }
    void window.pgp.getThread(openThreadId).then((t) => {
      setThread(t)
      if (t?.courseCode) setCourse(t.courseCode)
    })
  }, [openThreadId])

  // Keep the latest turn in view.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread, busy])

  const engineReady = engine?.available ?? false
  const courseCode = thread?.courseCode ?? course ?? ''

  // Resolve a slide's illustration once (library hit = instant/free). The ref
  // dedupes so a single image is never generated twice (e.g. StrictMode).
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
  const lastFollowups = turns.length > 0 ? turns[turns.length - 1].answer.followups : []

  return (
    <div className="tutor">
      <div className="tutor-bar">
        {thread ? (
          <span className="course-locked">
            {courseName}
            {thread.courseCode ? '' : ''}
          </span>
        ) : (
          <label className="course-select">
            <span className="course-select-label">Course</span>
            <select value={course} onChange={(e) => setCourse(e.target.value)} aria-label="Course scope">
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name} ({c.lessons})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

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

        {busy && <p className="muted small thinking">Teaching…</p>}
        {error && <p className="banner danger">Couldn’t answer: {error}</p>}
      </div>

      {lastFollowups.length > 0 && !busy && (
        <div className="followups">
          {lastFollowups.map((f) => (
            <button key={f} className="chip" onClick={() => ask(f)}>
              {f}
            </button>
          ))}
        </div>
      )}

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
  return (
    <div className="turn">
      <div className="turn-q">{turn.question}</div>
      <div className="turn-a">
        {a.kind === 'slides' ? (
          a.slides.map((s, i) => (
            <SlideBlock key={i} turnId={turn.id} slide={s} illus={illus} onNeed={onNeedIllustration} />
          ))
        ) : (
          <div className="answer-md">
            <ReactMarkdown>{toSuperscriptCitations(a.text)}</ReactMarkdown>
          </div>
        )}
        {a.sources.length > 0 && <Sources sources={a.sources} />}
      </div>
    </div>
  )
}

function SlideBlock(props: {
  turnId: string
  slide: Slide
  illus: Record<string, IllusEntry>
  onNeed: (turnId: string, spec: IllustrationSpec) => void
}): JSX.Element {
  const { turnId, slide, illus, onNeed } = props
  useEffect(() => {
    if (slide.illustration) onNeed(turnId, slide.illustration)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnId, slide.illustration?.id])

  const entry = slide.illustration ? illus[`${turnId}:${slide.illustration.id}`] : undefined
  return (
    <section className="slide-block">
      <h3 className="slide-heading">{slide.heading}</h3>
      {slide.illustration && <Illustration spec={slide.illustration} entry={entry} />}
      <div className="answer-md">
        <ReactMarkdown>{toSuperscriptCitations(slide.body)}</ReactMarkdown>
      </div>
    </section>
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

const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
function toSuperscriptCitations(md: string): string {
  return md.replace(/\[(\d{1,2})\]/g, (_m, n: string) =>
    n
      .split('')
      .map((d) => SUP[Number(d)] ?? d)
      .join('')
  )
}
