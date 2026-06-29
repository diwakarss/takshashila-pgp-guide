import { useEffect, useState } from 'react'
import { BookOpen, Bookmark, Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { CourseSummary, EngineStatus, TutorAnswer } from '../../../shared/ipc'

type IllusState = { id: string; title: string; status: 'drawing' | 'done' | 'error'; dataUrl?: string }

// Tutor — pick a course, ask, get a taught answer with superscript citations,
// and (on demand) hand-drawn illustrations when they'd genuinely help.
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [illusOn, setIllusOn] = useState(false)
  const [illustrations, setIllustrations] = useState<IllusState[]>([])

  useEffect(() => {
    if (ready) void window.pgp.courses().then(setCourses)
    void window.pgp.illustrationAvailable().then(setIllusOn)
  }, [ready])

  const engineReady = engine?.available ?? false
  const canAsk = ready && engineReady && !busy && q.trim().length > 0

  const illustrate = (question: string, answer: string): void => {
    setIllustrations([])
    void (async () => {
      const specs = await window.pgp.planIllustrations({ question, answer })
      if (specs.length === 0) return
      setIllustrations(specs.map((s) => ({ id: s.id, title: s.title, status: 'drawing' })))
      for (const spec of specs) {
        window.pgp
          .generateIllustration(spec)
          .then((img) =>
            setIllustrations((prev) =>
              prev.map((p) => (p.id === spec.id ? { ...p, status: 'done', dataUrl: img.dataUrl } : p))
            )
          )
          .catch(() =>
            setIllustrations((prev) => prev.map((p) => (p.id === spec.id ? { ...p, status: 'error' } : p)))
          )
      }
    })()
  }

  const ask = async (): Promise<void> => {
    if (!q.trim()) return
    const question = q.trim()
    setBusy(true)
    setError(null)
    setIllustrations([])
    try {
      const ans = await window.pgp.askTutor({ question, courseCode: course || undefined })
      setResult(ans)
      if (illusOn && ans.sources.length > 0) illustrate(question, ans.answer)
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
          Import the cohort lessons once, then pick a course and ask anything — and I’ll teach it, with
          the lessons it came from.
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
        <p className="muted">Pick a course, ask anything, and I’ll teach it — not just quote the readings.</p>
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

      {result && (
        <article className="answer">
          <div className="answer-md">
            <ReactMarkdown>{toSuperscriptCitations(result.answer)}</ReactMarkdown>
          </div>

          {illustrations.length > 0 && (
            <div className="illustrations">
              {illustrations.map((il) => (
                <figure key={il.id} className="illustration">
                  {il.status === 'done' && il.dataUrl ? (
                    <img src={il.dataUrl} alt={il.title} />
                  ) : il.status === 'error' ? (
                    <div className="illus-skel error">couldn’t draw this one</div>
                  ) : (
                    <div className="illus-skel">
                      <Pencil size={16} /> drawing “{il.title}”…
                    </div>
                  )}
                  <figcaption>{il.title}</figcaption>
                </figure>
              ))}
            </div>
          )}

          {result.sources.length > 0 && (
            <div className="sources">
              <div className="sources-head">
                <span className="muted small">Drawn from these lessons</span>
                <button className="chip ghost" title="Save to notebook (coming soon)" disabled>
                  <Bookmark size={14} /> Save
                </button>
              </div>
              <ol className="source-list">
                {result.sources.map((h, i) => (
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
          )}
        </article>
      )}
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
