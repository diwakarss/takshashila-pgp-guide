import { useEffect, useState } from 'react'
import { CheckSquare, Check, X, RotateCcw, Flame, Trophy, Target, Sparkles, Repeat } from 'lucide-react'
import type {
  CourseSummary,
  EngineStatus,
  IllustrationImage,
  QuizQuestion,
  QuizStats,
  QuizVerdict,
  WeakSpot
} from '../../../shared/ipc'

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
  statsVersion: number
  onRecorded: () => void
  onGoToSettings: () => void
}): JSX.Element {
  const { ready, engine, courses, statsVersion, onRecorded, onGoToSettings } = props
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
  const [stats, setStats] = useState<QuizStats | null>(null) // pre-quiz stats, shown on setup
  const [weak, setWeak] = useState<WeakSpot[]>([])
  const [reviewing, setReviewing] = useState(false)
  const [earned, setEarned] = useState<{ xp: number; leveledUp: boolean; stats: QuizStats } | null>(null)

  // Refresh scoring history whenever we return to setup (or another surface records).
  useEffect(() => {
    if (phase === 'setup') void window.pgp.quizStats().then(setStats)
  }, [phase, statsVersion])

  // Weak spots depend on the selected course scope.
  useEffect(() => {
    if (phase === 'setup') void window.pgp.quizWeakSpots(course || undefined).then(setWeak)
  }, [phase, statsVersion, course])

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

  const start = async (focusTopics?: string[]): Promise<void> => {
    setBusy(true)
    setError(null)
    setEarned(null)
    setReviewing(!!focusTopics?.length)
    try {
      const qs = await window.pgp.generateQuiz({ courseCode: course || undefined, count, focusTopics })
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

  const score = results.reduce((s, r) => s + (r.correct ? 1 : r.verdict?.verdict === 'partial' ? 0.5 : 0), 0)

  const finish = async (): Promise<void> => {
    setPhase('done')
    try {
      const before = stats
      // Per-question outcomes (parallel to `questions` — we always go in order),
      // keyed by the lesson each tested, feed weak-spot review.
      const answers = results.map((r, i) => ({
        topic: questions[i]?.source || questions[i]?.concept || 'General',
        courseCode: course || undefined,
        correct: r.correct ? 1 : r.verdict?.verdict === 'partial' ? 0.5 : 0
      }))
      const updated = await window.pgp.recordQuiz({
        courseCode: course || undefined,
        courseName: courses.find((c) => c.code === course)?.name,
        total: questions.length,
        correct: score,
        answers
      })
      setEarned({ xp: updated.xp - (before?.xp ?? 0), leveledUp: before ? updated.level > before.level : false, stats: updated })
      setStats(updated)
      onRecorded()
    } catch {
      /* keep the local score even if persistence fails */
    }
  }

  const next = (): void => {
    if (idx + 1 >= questions.length) {
      void finish()
      return
    }
    setIdx((i) => i + 1)
    resetQuestion()
  }

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
    const pct = stats && stats.levelSpan > 0 ? Math.round((stats.levelXp / stats.levelSpan) * 100) : 0
    return (
      <div className="surface quiz-setup">
        <header className="surface-head">
          <h1>Quiz</h1>
          <p className="muted">Test yourself — questions are drawn from your lessons and graded against them.</p>
        </header>

        {stats && (
          <section className="stat-tiles">
            <div className="stat-tile">
              <div className="stat-icon level">{stats.level}</div>
              <div className="stat-body">
                <div className="stat-value">Level {stats.level}</div>
                <div className="stat-bar" title={`${stats.levelXp} / ${stats.levelSpan} XP`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="stat-label">{stats.xp} XP total</div>
              </div>
            </div>
            <div className="stat-tile">
              <Flame size={22} strokeWidth={1.75} style={{ color: stats.streakDays > 0 ? '#e07a3c' : 'var(--muted)' }} />
              <div className="stat-body">
                <div className="stat-value">{stats.streakDays}</div>
                <div className="stat-label">day streak{stats.bestStreak > 1 ? ` · best ${stats.bestStreak}` : ''}</div>
              </div>
            </div>
            <div className="stat-tile">
              <Trophy size={22} strokeWidth={1.75} style={{ color: '#c99a2e' }} />
              <div className="stat-body">
                <div className="stat-value">{stats.totalQuizzes}</div>
                <div className="stat-label">quizzes taken</div>
              </div>
            </div>
            <div className="stat-tile">
              <Target size={22} strokeWidth={1.75} style={{ color: '#1d8a66' }} />
              <div className="stat-body">
                <div className="stat-value">{stats.totalQuestions > 0 ? `${Math.round(stats.accuracy * 100)}%` : '—'}</div>
                <div className="stat-label">accuracy</div>
              </div>
            </div>
          </section>
        )}

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
          <div className="quiz-start-row">
            <button className="btn primary quiz-start" disabled={!engineReady || busy} onClick={() => start()}>
              {busy && !reviewing ? 'Building your quiz…' : 'Start quiz'}
            </button>
            {weak.length > 0 && (
              <button
                className="btn quiz-review"
                disabled={!engineReady || busy}
                onClick={() => start(weak.map((w) => w.topic))}
                title="A quiz focused on the lessons you’ve been getting wrong"
              >
                <Repeat size={15} /> {busy && reviewing ? 'Building review…' : `Review ${weak.length} weak ${weak.length === 1 ? 'spot' : 'spots'}`}
              </button>
            )}
          </div>
          {error && <p className="banner danger">{error}</p>}
        </section>

        {weak.length > 0 && (
          <section className="quiz-weak">
            <div className="recents-label">
              <Target size={13} style={{ verticalAlign: '-2px', marginRight: 5, color: '#c96f3c' }} />
              Focus areas
            </div>
            <ul className="weak-list">
              {weak.map((w) => (
                <li key={`${w.courseCode}:${w.topic}`} className="weak-item">
                  <span className="weak-topic">{w.topic}</span>
                  {w.courseCode && <span className="weak-course">{w.courseCode}</span>}
                  <span className="weak-acc">{Math.round(w.accuracy * 100)}%</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {stats && stats.recent.length > 0 && (
          <section className="quiz-history">
            <div className="recents-label">Recent quizzes</div>
            <ul className="history-list">
              {stats.recent.map((a) => {
                const p = a.total > 0 ? a.correct / a.total : 0
                const grade = p >= 0.8 ? 'good' : p >= 0.5 ? 'ok' : 'low'
                return (
                  <li key={a.id} className="history-item">
                    <span className="history-course">{a.courseName ?? a.courseCode ?? 'Mixed'}</span>
                    <span className="history-date">{new Date(a.createdAt).toLocaleDateString()}</span>
                    <span className={`history-score ${grade}`}>
                      {a.correct % 1 === 0 ? a.correct : a.correct.toFixed(1)}/{a.total}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
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

          {earned && (
            <div className="quiz-rewards">
              {earned.leveledUp && (
                <div className="reward levelup">
                  <Sparkles size={16} /> Level up! You’re now level {earned.stats.level}
                </div>
              )}
              <div className="reward-row">
                <span className="reward xp">
                  <Sparkles size={14} /> +{earned.xp} XP
                </span>
                <span className="reward streak">
                  <Flame size={14} style={{ color: '#e07a3c' }} /> {earned.stats.streakDays}-day streak
                </span>
              </div>
            </div>
          )}

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
        {reviewing && (
          <span className="review-chip">
            <Repeat size={12} /> Review
          </span>
        )}
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
