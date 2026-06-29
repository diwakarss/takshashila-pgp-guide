import { useEffect, useState } from 'react'
import { BookOpen, Bookmark } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { CourseSummary, EngineStatus, TutorAnswer } from '../../../shared/ipc'

// Tutor — the default surface. Pick a course to scope the question, ask, and
// get a taught (not regurgitated) answer with superscript citations.
export function Tutor(props: {
  ready: boolean
  engine: EngineStatus | null
  onGoToSettings: () => void
}): JSX.Element {
  const { ready, engine, onGoToSettings } = props
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [course, setCourse] = useState<string>('') // '' = all courses
  const [q, setQ] = useState('')
  const [result, setResult] = useState<TutorAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (ready) void window.pgp.courses().then(setCourses)
  }, [ready])

  const engineReady = engine?.available ?? false
  const canAsk = ready && engineReady && !busy && q.trim().length > 0

  const ask = async (): Promise<void> => {
    if (!q.trim()) return
    setBusy(true)
    setError(null)
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
// Turn the model's [n] citation markers into subtle superscripts that match the
// numbered "drawn from these lessons" list.
function toSuperscriptCitations(md: string): string {
  return md.replace(/\[(\d{1,2})\]/g, (_m, n: string) =>
    n
      .split('')
      .map((d) => SUP[Number(d)] ?? d)
      .join('')
  )
}
