import { useEffect, useState } from 'react'
import { BookOpen, Pencil, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { CourseSummary, EngineStatus, IllustrationImage, IllustrationSpec, TutorReply } from '../../../shared/ipc'

type IllusEntry = { status: 'drawing' | 'done' | 'error'; dataUrl?: string; error?: string; quota?: boolean }

// Tutor — a threaded conversation. Each ask continues the thread (course-locked);
// replies are a slide walkthrough (concept) or plain text (simple question), each
// with follow-up suggestions. (Recents list + top bar land in the next pass.)
export function Tutor(props: { ready: boolean; engine: EngineStatus | null; onGoToSettings: () => void }): JSX.Element {
  const { ready, engine, onGoToSettings } = props
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [course, setCourse] = useState<string>('')
  const [threadId, setThreadId] = useState<string | undefined>(undefined)
  const [q, setQ] = useState('')
  const [reply, setReply] = useState<TutorReply | null>(null)
  const [slide, setSlide] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [illusOn, setIllusOn] = useState(false)
  const [illus, setIllus] = useState<Record<string, IllusEntry>>({})

  useEffect(() => {
    if (ready) void window.pgp.courses().then(setCourses)
    void window.pgp.illustrationAvailable().then(setIllusOn)
  }, [ready])

  const engineReady = engine?.available ?? false
  const slides = reply?.kind === 'slides' ? reply.slides : []
  const current = slides[slide]

  useEffect(() => {
    const spec = current?.illustration
    if (!illusOn || !spec || illus[spec.id]) return
    setIllus((p) => ({ ...p, [spec.id]: { status: 'drawing' } }))
    void window.pgp
      .generateIllustration(spec, course || undefined)
      .then((img: IllustrationImage) =>
        setIllus((p) => ({
          ...p,
          [spec.id]: img.dataUrl ? { status: 'done', dataUrl: img.dataUrl } : { status: 'error', error: img.error, quota: img.quota }
        }))
      )
      .catch((e) => setIllus((p) => ({ ...p, [spec.id]: { status: 'error', error: String(e) } })))
  }, [current, illusOn, illus, course])

  const ask = async (question: string): Promise<void> => {
    if (!question.trim()) return
    setBusy(true)
    setError(null)
    setIllus({})
    setSlide(0)
    setQ('')
    try {
      const res = await window.pgp.askTutor({ question: question.trim(), courseCode: course || undefined, threadId })
      setThreadId(res.threadId)
      setReply(res.turn.answer)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const newConversation = (): void => {
    setThreadId(undefined)
    setReply(null)
    setError(null)
    setIllus({})
    setQ('')
  }

  const onCourseChange = (code: string): void => {
    setCourse(code)
    newConversation() // changing course starts a fresh conversation
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

  const activeCourseName = course ? courses.find((c) => c.code === course)?.name ?? course : 'all courses'

  return (
    <div className="surface">
      <header className="surface-head tutor-head">
        <div>
          <h1>Tutor</h1>
          <p className="muted">Ask anything — I’ll teach concepts as a walkthrough, or just answer simply.</p>
        </div>
        <div className="tutor-head-controls">
          <label className="course-select">
            <span className="course-select-label">Course</span>
            <select value={course} onChange={(e) => onCourseChange(e.target.value)} aria-label="Course scope">
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name} ({c.lessons})
                </option>
              ))}
            </select>
          </label>
          {reply && (
            <button className="btn" onClick={newConversation} title="New conversation">
              <Plus size={16} /> New
            </button>
          )}
        </div>
      </header>

      {!engineReady && <p className="banner danger">Your AI ({engine?.label}) isn’t reachable right now.</p>}

      {!reply && !busy && (
        <div className="starter-chips">
          {['Explain thinking in degrees', 'Why do bans fail?', 'What is state capacity?'].map((s) => (
            <button key={s} className="chip" disabled={!engineReady} onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="banner danger">Couldn’t answer: {error}</p>}
      {busy && <p className="muted small" style={{ marginTop: 12 }}>Teaching…</p>}

      {reply && reply.kind === 'slides' && current && (
        <section className="slide" aria-live="polite">
          <h2 className="slide-heading">{current.heading}</h2>
          {current.illustration && <SlideIllustration spec={current.illustration} entry={illus[current.illustration.id]} />}
          <div className="answer-md">
            <ReactMarkdown>{toSuperscriptCitations(current.body)}</ReactMarkdown>
          </div>
          <nav className="slide-nav">
            <button className="btn" disabled={slide === 0} onClick={() => setSlide((s) => s - 1)}>
              <ChevronLeft size={16} /> Back
            </button>
            <span className="slide-count">
              {slide + 1} / {slides.length}
            </span>
            <button className="btn primary" disabled={slide >= slides.length - 1} onClick={() => setSlide((s) => s + 1)}>
              Next <ChevronRight size={16} />
            </button>
          </nav>
        </section>
      )}

      {reply && reply.kind === 'text' && (
        <section className="slide answer-md" aria-live="polite">
          <ReactMarkdown>{toSuperscriptCitations(reply.text)}</ReactMarkdown>
        </section>
      )}

      {reply && reply.sources.length > 0 && <SourcesBlock sources={reply.sources} />}

      {reply && reply.followups.length > 0 && (
        <div className="followups">
          <span className="muted small">Ask next</span>
          <div className="starter-chips">
            {reply.followups.map((f) => (
              <button key={f} className="chip" disabled={busy} onClick={() => ask(f)}>
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ask-row ask-dock">
        <input
          className="input"
          placeholder={reply ? 'Ask a follow-up…' : `Ask about ${activeCourseName}…`}
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

function SlideIllustration(props: { spec: IllustrationSpec; entry: IllusEntry | undefined }): JSX.Element {
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

function SourcesBlock(props: { sources: TutorReply['sources'] }): JSX.Element {
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
