import { useState } from 'react'
import { CheckSquare, Check, X, RotateCcw } from 'lucide-react'
import type { CourseSummary, EngineStatus, QuizQuestion, QuizVerdict } from '../../../shared/ipc'

type Result = { correct: boolean; verdict?: QuizVerdict }

// Quiz — Stage 1: pick a course → generate questions from the corpus (MCQ +
// free-form) → answer → graded reveal with the source → score. Gamification,
// spaced repetition, and a dashboard come next.
export function Quiz(props: {
  ready: boolean
  engine: EngineStatus | null
  courses: CourseSummary[]
  onGoToSettings: () => void
}): JSX.Element {
  const { ready, engine, courses, onGoToSettings } = props
  const [phase, setPhase] = useState<'setup' | 'taking' | 'done'>('setup')
  const [course, setCourse] = useState('')
  const [count, setCount] = useState(6)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [idx, setIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [verdict, setVerdict] = useState<QuizVerdict | null>(null)
  const [grading, setGrading] = useState(false)
  const [results, setResults] = useState<Result[]>([])

  const engineReady = engine?.available ?? false
  const q = questions[idx]

  const resetQuestion = (): void => {
    setSelected(null)
    setText('')
    setRevealed(false)
    setVerdict(null)
  }

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const qs = await window.pgp.generateQuiz({ courseCode: course || undefined, count })
      if (qs.length === 0) {
        setError('Couldn’t generate a quiz for this scope — try another course.')
        return
      }
      setQuestions(qs)
      setIdx(0)
      setResults([])
      resetQuestion()
      setPhase('taking')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (!q || revealed) return
    if (q.kind === 'mcq') {
      if (selected == null) return
      setResults((r) => [...r, { correct: selected === q.answerIndex }])
      setRevealed(true)
    } else {
      if (!text.trim()) return
      setGrading(true)
      try {
        const v = await window.pgp.gradeQuiz({ prompt: q.prompt, modelAnswer: q.modelAnswer }, text.trim())
        setVerdict(v)
        setResults((r) => [...r, { correct: v.verdict === 'correct', verdict: v }])
        setRevealed(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setGrading(false)
      }
    }
  }

  const next = (): void => {
    if (idx + 1 >= questions.length) {
      setPhase('done')
      return
    }
    setIdx((i) => i + 1)
    resetQuestion()
  }

  const score = results.reduce((s, r) => s + (r.correct ? 1 : r.verdict?.verdict === 'partial' ? 0.5 : 0), 0)

  if (!ready) {
    return (
      <div className="empty">
        <CheckSquare size={40} strokeWidth={1.25} className="empty-icon" style={{ color: '#1d8a66' }} />
        <h2>Set up your course library</h2>
        <p className="muted">Import the cohort lessons once, then quiz yourself on them.</p>
        <button className="btn primary" onClick={onGoToSettings}>
          Go to Settings
        </button>
      </div>
    )
  }

  // ── setup ───────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="surface">
        <header className="surface-head">
          <h1>Quiz</h1>
          <p className="muted">Test yourself — questions are drawn from your lessons and graded against them.</p>
        </header>
        <section className="card">
          <div className="quiz-setup-row">
            <label className="course-select">
              <span className="course-select-label">Course</span>
              <select value={course} onChange={(e) => setCourse(e.target.value)}>
                <option value="">All courses</option>
                {courses.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name} ({c.lessons})
                  </option>
                ))}
              </select>
            </label>
            <div className="quiz-len">
              <span className="course-select-label">Questions</span>
              <div className="len-chips">
                {[5, 8, 10].map((n) => (
                  <button
                    key={n}
                    className={`chip${count === n ? ' active' : ''}`}
                    onClick={() => setCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {!engineReady && <p className="banner danger">Your AI ({engine?.label}) isn’t reachable right now.</p>}
          <button className="btn primary quiz-start" disabled={!engineReady || busy} onClick={start}>
            {busy ? 'Building your quiz…' : 'Start quiz'}
          </button>
          {error && <p className="banner danger">{error}</p>}
        </section>
      </div>
    )
  }

  // ── done ────────────────────────────────────────────────
  if (phase === 'done') {
    const pct = questions.length ? Math.round((score / questions.length) * 100) : 0
    return (
      <div className="surface">
        <div className="quiz-done">
          <h2>Quiz complete</h2>
          <div className="quiz-score">
            {score % 1 === 0 ? score : score.toFixed(1)} / {questions.length}
          </div>
          <p className="muted">{pct}% — {pct >= 80 ? 'strong recall!' : pct >= 50 ? 'solid, keep at it.' : 'worth another pass.'}</p>
          <button className="btn primary" onClick={() => setPhase('setup')}>
            <RotateCcw size={16} /> New quiz
          </button>
        </div>
      </div>
    )
  }

  // ── taking ──────────────────────────────────────────────
  return (
    <div className="surface quiz">
      <div className="quiz-progress">
        Question {idx + 1} of {questions.length}
      </div>
      {q && (
        <section className="quiz-card">
          <div className="quiz-prompt">{q.prompt}</div>

          {q.kind === 'mcq' ? (
            <div className="quiz-options">
              {q.options.map((opt, i) => {
                let cls = 'quiz-option'
                if (revealed) {
                  if (i === q.answerIndex) cls += ' correct'
                  else if (i === selected) cls += ' wrong'
                } else if (i === selected) cls += ' selected'
                return (
                  <button key={i} className={cls} disabled={revealed} onClick={() => setSelected(i)}>
                    {revealed && i === q.answerIndex && <Check size={16} />}
                    {revealed && i === selected && i !== q.answerIndex && <X size={16} />}
                    <span>{opt}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <textarea
              className="quiz-textarea"
              placeholder="Answer in a few sentences…"
              value={text}
              disabled={revealed || grading}
              onChange={(e) => setText(e.target.value)}
            />
          )}

          {revealed && (
            <div className="quiz-reveal">
              {q.kind === 'freeform' && verdict && (
                <div className={`verdict ${verdict.verdict}`}>
                  {verdict.verdict === 'correct' ? 'Correct' : verdict.verdict === 'partial' ? 'Partly right' : 'Not quite'}
                  {verdict.feedback && <span className="verdict-fb"> — {verdict.feedback}</span>}
                </div>
              )}
              {q.kind === 'freeform' && q.modelAnswer && (
                <p className="quiz-model">
                  <strong>Model answer:</strong> {q.modelAnswer}
                </p>
              )}
              {q.explanation && <p className="quiz-explain">{q.explanation}</p>}
              {q.source && <p className="muted small">From: {q.source}</p>}
            </div>
          )}

          <div className="quiz-actions">
            {!revealed ? (
              <button
                className="btn primary"
                disabled={grading || (q.kind === 'mcq' ? selected == null : !text.trim())}
                onClick={submit}
              >
                {grading ? 'Grading…' : 'Submit'}
              </button>
            ) : (
              <button className="btn primary" onClick={next}>
                {idx + 1 >= questions.length ? 'Finish' : 'Next'}
              </button>
            )}
          </div>
        </section>
      )}
      {error && <p className="banner danger">{error}</p>}
    </div>
  )
}
