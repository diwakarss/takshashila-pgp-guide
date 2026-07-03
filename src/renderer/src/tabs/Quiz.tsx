import { useEffect, useState } from 'react'
import { CheckSquare, Check, X, RotateCcw } from 'lucide-react'
import type { CourseSummary, EngineStatus, IllustrationImage, QuizQuestion, QuizVerdict } from '../../../shared/ipc'

type Result = { correct: boolean; verdict?: QuizVerdict }

const sameSet = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i])

// Quiz — Stage 1: pick a course → generate a varied set of questions from the
// corpus (MCQ, true/false, select-all, short free-form) → answer → graded
// reveal with the source and, when we already have one, a matching illustration
// → score. Gamification, spaced repetition, and a dashboard come next.
export function Quiz(props: {
  ready: boolean
  engine: EngineStatus | null
  courses: CourseSummary[]
  onGoToSettings: () => void
}): JSX.Element {
  const { ready, engine, courses, onGoToSettings } = props
  const [phase, setPhase] = useState<'setup' | 'taking' | 'done'>('setup')
  const [course, setCourse] = useState('')
  const [count, setCount] = useState(8)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [idx, setIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null) // mcq / truefalse
  const [multiSel, setMultiSel] = useState<number[]>([]) // multi
  const [text, setText] = useState('') // freeform
  const [revealed, setRevealed] = useState(false)
  const [verdict, setVerdict] = useState<QuizVerdict | null>(null)
  const [grading, setGrading] = useState(false)
  const [illus, setIllus] = useState<IllustrationImage | null>(null)
  const [results, setResults] = useState<Result[]>([])

  const engineReady = engine?.available ?? false
  const q = questions[idx]
  const isSingle = q?.kind === 'mcq' || q?.kind === 'truefalse'

  const resetQuestion = (): void => {
    setSelected(null)
    setMultiSel([])
    setText('')
    setRevealed(false)
    setVerdict(null)
    setIllus(null)
  }

  // On reveal, reuse an existing library illustration for this concept if one
  // matches. This never generates — quizzes stay free and instant.
  useEffect(() => {
    if (!revealed || !q?.concept) return
    let live = true
    void window.pgp.quizIllustration(q.concept, course || undefined).then((img) => {
      if (live && img.dataUrl) setIllus(img)
    })
    return () => {
      live = false
    }
  }, [revealed, idx]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const toggleMulti = (i: number): void =>
    setMultiSel((s) => (s.includes(i) ? s.filter((n) => n !== i) : [...s, i]))

  const submit = async (): Promise<void> => {
    if (!q || revealed) return
    if (isSingle) {
      if (selected == null) return
      setResults((r) => [...r, { correct: selected === q.answerIndex }])
      setRevealed(true)
    } else if (q.kind === 'multi') {
      if (multiSel.length === 0) return
      setResults((r) => [...r, { correct: sameSet(multiSel, q.answerIndexes) }])
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
                  <button key={n} className={`chip${count === n ? ' active' : ''}`} onClick={() => setCount(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="muted small">Mixed formats — multiple choice, true/false, select-all, and a few written answers.</p>
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
          <p className="muted">
            {pct}% — {pct >= 80 ? 'strong recall!' : pct >= 50 ? 'solid, keep at it.' : 'worth another pass.'}
          </p>
          <button className="btn primary" onClick={() => setPhase('setup')}>
            <RotateCcw size={16} /> New quiz
          </button>
        </div>
      </div>
    )
  }

  // ── taking ──────────────────────────────────────────────
  const kindLabel =
    q?.kind === 'truefalse' ? 'True or false' : q?.kind === 'multi' ? 'Select all that apply' : q?.kind === 'freeform' ? 'Written answer' : 'Multiple choice'

  return (
    <div className="surface quiz">
      <div className="quiz-progress">
        Question {idx + 1} of {questions.length}
      </div>
      {q && (
        <section className="quiz-card">
          <div className="quiz-kind">{kindLabel}</div>
          <div className="quiz-prompt">{q.prompt}</div>

          {isSingle && (
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
          )}

          {q.kind === 'multi' && (
            <div className="quiz-options">
              {q.options.map((opt, i) => {
                const picked = multiSel.includes(i)
                const isAnswer = q.answerIndexes.includes(i)
                let cls = 'quiz-option multi'
                if (revealed) {
                  if (isAnswer) cls += ' correct'
                  else if (picked) cls += ' wrong'
                } else if (picked) cls += ' selected'
                return (
                  <button key={i} className={cls} disabled={revealed} onClick={() => toggleMulti(i)}>
                    <span className={`box${picked ? ' on' : ''}`}>{picked && <Check size={13} />}</span>
                    <span>{opt}</span>
                    {revealed && isAnswer && <Check size={16} className="mark" />}
                    {revealed && picked && !isAnswer && <X size={16} className="mark" />}
                  </button>
                )
              })}
            </div>
          )}

          {q.kind === 'freeform' && (
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
              {illus?.dataUrl && (
                <figure className="quiz-illus">
                  <img src={illus.dataUrl} alt={illus.title} />
                  <figcaption className="muted small">{illus.title}</figcaption>
                </figure>
              )}
              {q.source && <p className="muted small">From: {q.source}</p>}
            </div>
          )}

          <div className="quiz-actions">
            {!revealed ? (
              <button
                className="btn primary"
                disabled={grading || (isSingle ? selected == null : q.kind === 'multi' ? multiSel.length === 0 : !text.trim())}
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
