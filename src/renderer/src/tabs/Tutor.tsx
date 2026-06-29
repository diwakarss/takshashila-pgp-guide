import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Bookmark, Pencil, ChevronLeft, ChevronRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { CourseSummary, EngineStatus, IllustrationImage, IllustrationSpec, TutorAnswer } from '../../../shared/ipc'

type IllusEntry = { status: 'drawing' | 'done' | 'error'; dataUrl?: string; error?: string; quota?: boolean }

// Tutor — pick a course, ask, and step through a taught SLIDE sequence with
// next/prev. Each slide may carry a hand-drawn illustration, generated on
// demand only when you reach that slide.
export function Tutor(props: {
  ready: boolean
  engine: EngineStatus | null
  onGoToSettings: () => void
}): JSX.Element {
  const { ready, engine, onGoToSettings } = props
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [course, setCourse] = useState<string>('')
  const [q, setQ] = useState('')
  const [result, setResult] = useState<TutorAnswer | null>(null)
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
  const canAsk = ready && engineReady && !busy && q.trim().length > 0
  const slides = result?.slides ?? []
  const current = slides[slide]

  // Lazily draw the current slide's illustration the first time it's viewed.
  useEffect(() => {
    const spec = current?.illustration
    if (!illusOn || !spec || illus[spec.id]) return
    setIllus((p) => ({ ...p, [spec.id]: { status: 'drawing' } }))
    void window.pgp
      .generateIllustration(spec, course || undefined)
      .then((img: IllustrationImage) =>
        setIllus((p) => ({
          ...p,
          [spec.id]: img.dataUrl
            ? { status: 'done', dataUrl: img.dataUrl }
            : { status: 'error', error: img.error, quota: img.quota }
        }))
      )
      .catch((e) => setIllus((p) => ({ ...p, [spec.id]: { status: 'error', error: String(e) } })))
  }, [current, illusOn, illus])

  const ask = async (): Promise<void> => {
    if (!q.trim()) return
    setBusy(true)
    setError(null)
    setIllus({})
    setSlide(0)
    try {
      setResult(await window.pgp.askTutor({ question: q.trim(), courseCode: course || undefined }))
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
        <p className="muted">
          Import the cohort lessons once, then pick a course and ask anything — and I’ll teach it as a
          short walkthrough.
        </p>
        <button className="btn primary" onClick={onGoToSettings}>
          Go to Settings
        </button>
      </div>
    )
  }

  const activeCourseName = course ? courses.find((c) => c.code === course)?.name ?? course : 'all courses'

  return (
    <div className="surface">
      <header className="surface-head">
        <h1>Tutor</h1>
        <p className="muted">Pick a course, ask anything, and I’ll walk you through it step by step.</p>
      </header>

      <div className="ask-bar">
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
      </div>

      {!engineReady && (
        <p className="banner danger">Your AI ({engine?.label}) isn’t reachable right now. Check it in Settings.</p>
      )}

      <div className="ask-row">
        <input
          className="input"
          placeholder={`Ask about ${activeCourseName}…`}
          value={q}
          disabled={!engineReady || busy}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canAsk && ask()}
        />
        <button className="btn primary" disabled={!canAsk} onClick={ask}>
          {busy ? 'Teaching…' : 'Ask'}
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

      {result && current && (
        <>
          <section className="slide" aria-live="polite">
            <h2 className="slide-heading">{current.heading}</h2>
            {current.illustration && (
              <SlideIllustration spec={current.illustration} entry={illus[current.illustration.id]} />
            )}
            <div className="answer-md">
              <ReactMarkdown>{toSuperscriptCitations(current.body)}</ReactMarkdown>
            </div>
          </section>

          <nav className="slide-nav">
            <button className="btn" disabled={slide === 0} onClick={() => setSlide((s) => s - 1)}>
              <ChevronLeft size={16} /> Back
            </button>
            <span className="slide-count">
              {slide + 1} / {slides.length}
            </span>
            <button
              className="btn primary"
              disabled={slide >= slides.length - 1}
              onClick={() => setSlide((s) => s + 1)}
            >
              Next <ChevronRight size={16} />
            </button>
          </nav>

          <SourcesBlock sources={result.sources} />
        </>
      )}
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

function SourcesBlock(props: { sources: TutorAnswer['sources'] }): JSX.Element | null {
  const { sources } = props
  const deduped = useMemo(() => sources, [sources])
  if (deduped.length === 0) return null
  return (
    <div className="sources">
      <div className="sources-head">
        <span className="muted small">Drawn from these lessons</span>
        <button className="chip ghost" title="Save to notebook (coming soon)" disabled>
          <Bookmark size={14} /> Save
        </button>
      </div>
      <ol className="source-list">
        {deduped.map((h, i) => (
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
