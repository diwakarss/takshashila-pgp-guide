import { useEffect, useRef, useState } from 'react'
import {
  FileText,
  Check,
  Sparkles,
  Search,
  Users,
  ClipboardCheck,
  Repeat,
  Trash2,
  BookMarked,
  Copy,
  ChevronRight,
  X,
  Lightbulb
} from 'lucide-react'
import { Md } from '../components/Markdown'
import { BARDACH_STEPS } from '../../../shared/ipc'
import type {
  CoachAction,
  CoachResult,
  EngineStatus,
  NotebookPageSummary,
  NoteSource,
  Project,
  ProjectListItem,
  ProjectsOverview
} from '../../../shared/ipc'

const ANTI_PLAGIARISM =
  'I attest that the work presented in this assignment is my own original work, with the exception of any text and references that have been acknowledged as part of the citations.'
const AI_DISCLAIMERS = [
  'None of the work produced in this assignment has been produced using an AI-based tool.',
  'The analysis in this assignment was done with the support of AI tools for research leads and copy-editing; the final work is my own.'
]

const COACH_BAR: { action: CoachAction; label: string; hint: string; icon: typeof Sparkles }[] = [
  { action: 'brainstorm', label: 'Brainstorm', hint: 'Socratic questions to get you thinking — it won’t answer for you', icon: Sparkles },
  { action: 'evidence', label: 'Find evidence', hint: 'Real sources and datasets to go gather', icon: Search },
  { action: 'stakeholders', label: 'Stakeholder map', hint: 'Who’s involved: Actor · Position · Interest · Influence', icon: Users },
  { action: 'proofread', label: 'Proofread', hint: 'Suggestions on YOUR draft — never a rewrite', icon: ClipboardCheck },
  { action: 'review', label: 'Review draft', hint: 'A critical read: argument, values, causal logic', icon: Repeat }
]

function dueLabel(dueAt: string | null): { text: string; tone: 'soon' | 'overdue' | 'ok' } | null {
  if (!dueAt) return null
  const due = new Date(dueAt)
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000)
  const date = due.toLocaleDateString([], { month: 'short', day: 'numeric' })
  if (days < 0) return { text: `Overdue · ${date}`, tone: 'overdue' }
  if (days === 0) return { text: `Due today · ${date}`, tone: 'soon' }
  return { text: `Due ${date} · ${days} day${days === 1 ? '' : 's'}`, tone: days <= 3 ? 'soon' : 'ok' }
}

// Projects — assignment-driven, no-write scaffold (PRD §8.5). The project list
// lives in the sidebar (uniform with other tabs); this pane shows either a
// how-it-works welcome or the open project's guided workspace.
export function Projects(props: {
  engine: EngineStatus | null
  openId: string | null
  onOpenProject: (id: string | null) => void
  onChanged: () => void
}): JSX.Element {
  const { engine, openId, onOpenProject, onChanged } = props
  if (openId) return <Editor id={openId} engine={engine} onChanged={onChanged} />
  return <Welcome onOpen={onOpenProject} onChanged={onChanged} />
}

// ── welcome / how it works ─────────────────────────────────────────────────
function Welcome({ onOpen, onChanged }: { onOpen: (id: string) => void; onChanged: () => void }): JSX.Element {
  const [overview, setOverview] = useState<ProjectsOverview | null>(null)
  useEffect(() => {
    void window.pgp.projectsOverview().then(setOverview)
  }, [])

  const openItem = async (item: ProjectListItem): Promise<void> => {
    const p = await window.pgp.openProject(item.id)
    if (p) {
      onOpen(p.id)
      onChanged()
    }
  }

  const upNext = overview ? [...overview.assignments].sort((a, b) => (a.dueAt ?? '9') < (b.dueAt ?? '9') ? -1 : 1) : []

  return (
    <div className="surface proj-welcome">
      <header className="surface-head">
        <h1>Projects</h1>
        <p className="muted">Where your assignments and capstone get written — with a coach, not a ghostwriter.</p>
      </header>

      <section className="card proj-how">
        <h2>How it works</h2>
        <ol className="proj-how-list">
          <li>
            <strong>Pick a project</strong> from the left — an assignment, your capstone, or a personal piece.
          </li>
          <li>
            <strong>Read the brief</strong>, then work through the 8 steps of a policy analysis. Each step tells
            you exactly what to do; tick it off and move to the next.
          </li>
          <li>
            <strong>Write in your own words</strong> in the draft pane. The coach buttons help you think, find
            evidence, and proofread — they will never write your submission for you (Takshashila’s AI policy).
          </li>
          <li>
            <strong>Pull in evidence</strong> from your Notebook, and when you’re done, copy the export — draft,
            bibliography, and the required disclaimers, ready to submit.
          </li>
        </ol>
      </section>

      {upNext.length > 0 && (
        <section className="proj-group">
          <div className="recents-label">Up next</div>
          <div className="proj-cards">
            {upNext.map((a) => {
              const due = dueLabel(a.dueAt)
              return (
                <button key={a.id} className="proj-card" onClick={() => void openItem(a)}>
                  <div className="proj-card-top">
                    <span className="proj-card-title">{a.title}</span>
                    {a.courseCode && <span className="proj-course">{a.courseCode}</span>}
                  </div>
                  <div className="proj-card-meta">
                    <span>{a.deliverable}</span>
                    {due && <span className={`proj-due ${due.tone}`}>{due.text}</span>}
                  </div>
                  {a.started ? (
                    <div className="proj-progress">
                      <span style={{ width: `${Math.round(a.progress * 100)}%` }} />
                    </div>
                  ) : (
                    <span className="proj-start-hint">Not started — open to begin</span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

// ── the guided workspace ───────────────────────────────────────────────────
function Editor({ id, engine, onChanged }: { id: string; engine: EngineStatus | null; onChanged: () => void }): JSX.Element {
  const [project, setProject] = useState<Project | null>(null)
  const [draft, setDraft] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [coach, setCoach] = useState<CoachResult | null>(null)
  const [coaching, setCoaching] = useState<CoachAction | null>(null)
  const [showEvidence, setShowEvidence] = useState(false)
  const [pages, setPages] = useState<NotebookPageSummary[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [showIntro, setShowIntro] = useState(() => localStorage.getItem('pgp.projIntroSeen') !== '1')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const engineReady = engine?.available ?? false

  useEffect(() => {
    setCoach(null)
    void window.pgp.openProject(id).then((p) => {
      setProject(p)
      setDraft(p?.draft ?? '')
      setSaveState('idle')
    })
  }, [id])

  const dismissIntro = (): void => {
    localStorage.setItem('pgp.projIntroSeen', '1')
    setShowIntro(false)
  }

  const patch = async (p: { title?: string; draft?: string; step?: number; done?: number[] }): Promise<void> => {
    const updated = await window.pgp.updateProject(id, p)
    if (updated) setProject(updated)
    onChanged()
  }

  const saveDraft = (next: string): void => {
    setDraft(next)
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void window.pgp.updateProject(id, { draft: next }).then((p) => {
        setSaveState('saved')
        if (p) setProject(p)
      })
    }, 700)
  }

  const toggleDone = (i: number): void => {
    if (!project) return
    const done = project.done.includes(i) ? project.done.filter((x) => x !== i) : [...project.done, i]
    void patch({ done })
  }

  // The friendly path: mark the current step done and advance to the next.
  const completeStep = (): void => {
    if (!project) return
    const done = project.done.includes(project.step) ? project.done : [...project.done, project.step]
    const step = Math.min(project.step + 1, BARDACH_STEPS.length - 1)
    void patch({ done, step })
  }

  const runCoach = async (action: CoachAction): Promise<void> => {
    if (!engineReady || coaching) return
    setCoaching(action)
    setCoach(null)
    try {
      const res = await window.pgp.projectCoach(id, action)
      setCoach(res)
    } finally {
      setCoaching(null)
    }
  }

  const openEvidence = (): void => {
    setShowEvidence(true)
    void window.pgp.notebookList().then(setPages)
  }

  const addEvidence = async (pageId: string): Promise<void> => {
    const page = await window.pgp.notebookGet(pageId)
    if (!page) return
    const sources = dedupe(page.snippets.flatMap((x) => x.sources))
    const updated = await window.pgp.addProjectEvidence(id, {
      title: page.title,
      note: `${page.snippets.length} note${page.snippets.length === 1 ? '' : 's'}`,
      sources,
      pageId
    })
    if (updated) setProject(updated)
    setShowEvidence(false)
  }

  const removeEvidence = async (evidenceId: string): Promise<void> => {
    const updated = await window.pgp.removeProjectEvidence(id, evidenceId)
    if (updated) setProject(updated)
  }

  const copyExport = async (): Promise<void> => {
    if (!project) return
    const biblio = dedupe(project.evidence.flatMap((e) => e.sources))
    const lines = [
      `# ${project.title}`,
      project.deliverable ? `_${project.deliverable}_` : '',
      '',
      project.draft.trim() || '_(your draft goes here)_',
      '',
      biblio.length ? '## Sources' : '',
      ...biblio.map((s, i) => `${i + 1}. ${s.title}${s.url ? ` — ${s.url}` : ''}`),
      '',
      '## Disclaimers',
      `Anti-plagiarism: ${ANTI_PLAGIARISM}`,
      `Generative AI: ${AI_DISCLAIMERS[1]}`
    ]
    await navigator.clipboard.writeText(lines.filter((l) => l !== undefined).join('\n'))
    setToast('Export (draft + sources + disclaimers) copied to clipboard')
    setTimeout(() => setToast(null), 2600)
  }

  const copyText = async (text: string, label: string): Promise<void> => {
    await navigator.clipboard.writeText(text)
    setToast(`${label} copied`)
    setTimeout(() => setToast(null), 2000)
  }

  if (!project) return <p className="muted" style={{ padding: 24 }}>Loading…</p>

  const step = BARDACH_STEPS[project.step]
  const due = dueLabel(project.dueAt)
  const isLastStep = project.step >= BARDACH_STEPS.length - 1
  const stepDone = project.done.includes(project.step)

  return (
    <div className="proj-editor">
      <div className="proj-ed-head">
        {project.kind === 'personal' ? (
          <input
            className="nb-title proj-title-input"
            value={project.title}
            placeholder="Project title"
            onChange={(e) => {
              setProject({ ...project, title: e.target.value })
              void patch({ title: e.target.value })
            }}
          />
        ) : (
          <h2 className="proj-title">{project.title}</h2>
        )}
        <div className="proj-ed-meta">
          {project.courseCode && <span className="proj-course">{project.courseCode}</span>}
          <span className="proj-deliverable">{project.deliverable}</span>
          {due && <span className={`proj-due ${due.tone}`}>{due.text}</span>}
        </div>
      </div>

      {showIntro && (
        <div className="proj-intro">
          <Lightbulb size={16} className="proj-intro-icon" />
          <div>
            <strong>First time here?</strong> Read the brief below, then follow the steps on the left — the “What
            to do” card walks you through each one. Draft in your own words; the coach buttons help you think but
            never write for you. When done, copy the export with your disclaimers.
          </div>
          <button className="icon-btn" title="Got it" onClick={dismissIntro}>
            <X size={15} />
          </button>
        </div>
      )}

      {project.brief && (
        <section className="proj-brief-card">
          <div className="proj-brief-head">
            <FileText size={15} /> The brief
          </div>
          <p>{project.brief}</p>
        </section>
      )}

      <div className="proj-body">
        <aside className="proj-steps">
          <div className="recents-label">Your 8 steps</div>
          <ul>
            {BARDACH_STEPS.map((s, i) => {
              const done = project.done.includes(i)
              const active = project.step === i
              return (
                <li key={s.key}>
                  <button
                    className={`proj-step${active ? ' active' : ''}${done ? ' done' : ''}`}
                    title={s.guide}
                    onClick={() => void patch({ step: i })}
                  >
                    <span
                      className={`proj-step-box${done ? ' on' : ''}`}
                      title={done ? 'Mark not done' : 'Mark done'}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleDone(i)
                      }}
                    >
                      {done && <Check size={12} />}
                    </span>
                    <span className="proj-step-title">
                      {i + 1}. {s.title}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="proj-steps-hint muted small">
            The classic 8 steps of a policy analysis (Bardach). Click a step to focus it.
          </p>
        </aside>

        <div className="proj-main">
          {step && (
            <section className="proj-stepguide">
              <div className="proj-stepguide-head">
                <span className="proj-stepguide-label">
                  Step {project.step + 1} of {BARDACH_STEPS.length} · What to do
                </span>
                <span className="proj-lens-chip">India lens · {step.lens}</span>
              </div>
              <p className="proj-stepguide-text">{step.guide}</p>
              <button className="btn primary proj-step-next" onClick={completeStep} disabled={stepDone && isLastStep}>
                {isLastStep ? (stepDone ? 'All steps done ✓' : 'Mark final step done') : (
                  <>
                    Done — next step <ChevronRight size={15} />
                  </>
                )}
              </button>
            </section>
          )}

          <div className="proj-toolbar">
            {COACH_BAR.map(({ action, label, hint, icon: Icon }) => (
              <button
                key={action}
                className="lens-btn"
                title={hint}
                disabled={!engineReady || !!coaching}
                onClick={() => void runCoach(action)}
              >
                <Icon size={14} /> {coaching === action ? 'Coaching…' : label}
              </button>
            ))}
            <button className="lens-btn" title="Pull a Notebook page (notes + sources) into this project" onClick={openEvidence}>
              <BookMarked size={14} /> Add evidence
            </button>
          </div>

          <textarea
            className="proj-draft"
            placeholder={`Your ${project.deliverable.toLowerCase().includes('video') ? 'video script' : 'draft'} — in your own words. Start rough; the coach can proofread once something’s here.`}
            value={draft}
            onChange={(e) => saveDraft(e.target.value)}
          />
          <div className="proj-draft-foot muted small">
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : ''}
            <button className="nb-showall" onClick={() => void copyExport()}>
              <Copy size={12} /> Copy export (draft + sources + disclaimers)
            </button>
          </div>

          {coaching && !coach && <div className="proj-coach loading muted">Your coach is thinking…</div>}
          {coach && (
            <div className={`proj-coach${coach.blocked ? ' blocked' : ''}`}>
              <div className="proj-coach-head">
                {coach.title}
                <button className="icon-btn" title="Dismiss" onClick={() => setCoach(null)}>
                  <X size={14} />
                </button>
              </div>
              <div className="answer-md">
                <Md>{coach.markdown}</Md>
              </div>
            </div>
          )}

          {project.evidence.length > 0 && (
            <div className="proj-evidence">
              <div className="recents-label">Evidence</div>
              {project.evidence.map((e) => (
                <div key={e.id} className="proj-ev-item">
                  <div className="proj-ev-main">
                    <BookMarked size={14} />
                    <span className="proj-ev-title">{e.title}</span>
                    <span className="muted small">
                      {e.note}
                      {e.sources.length > 0 && ` · ${e.sources.length} source${e.sources.length === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <button className="icon-btn" title="Remove" onClick={() => void removeEvidence(e.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <details className="proj-disclaimers">
            <summary>Submission disclaimers (Takshashila policy)</summary>
            <div className="proj-disc-item">
              <p>
                <strong>Anti-plagiarism:</strong> {ANTI_PLAGIARISM}
              </p>
              <button className="nb-showall" onClick={() => void copyText(ANTI_PLAGIARISM, 'Anti-plagiarism disclaimer')}>
                Copy
              </button>
            </div>
            {AI_DISCLAIMERS.map((d, i) => (
              <div key={i} className="proj-disc-item">
                <p>
                  <strong>AI-use option {i + 1}:</strong> {d}
                </p>
                <button className="nb-showall" onClick={() => void copyText(d, 'AI-use disclaimer')}>
                  Copy
                </button>
              </div>
            ))}
          </details>
        </div>
      </div>

      {showEvidence && (
        <div className="capture-overlay" onMouseDown={() => setShowEvidence(false)}>
          <div className="capture-panel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="capture-head">Pull in a Notebook page as evidence</div>
            {pages.length === 0 ? (
              <p className="muted small">No notebook pages yet — capture some research first.</p>
            ) : (
              <ul className="proj-ev-picker">
                {pages.map((p) => (
                  <li key={p.id}>
                    <button className="recent-item" onClick={() => void addEvidence(p.id)}>
                      {p.title} <span className="muted small">· {p.snippets} note{p.snippets === 1 ? '' : 's'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="capture-actions">
              <button className="btn" onClick={() => setShowEvidence(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function dedupe(sources: NoteSource[]): NoteSource[] {
  const seen = new Set<string>()
  const out: NoteSource[] = []
  for (const s of sources) {
    const key = (s.url || s.title).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}
