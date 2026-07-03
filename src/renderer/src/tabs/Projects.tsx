import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Sparkles,
  Search,
  Users,
  ClipboardCheck,
  Repeat,
  Plus,
  Trash2,
  BookMarked,
  Copy
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

const COACH_BAR: { action: CoachAction; label: string; icon: typeof Sparkles }[] = [
  { action: 'brainstorm', label: 'Brainstorm', icon: Sparkles },
  { action: 'evidence', label: 'Find evidence', icon: Search },
  { action: 'stakeholders', label: 'Stakeholder map', icon: Users },
  { action: 'proofread', label: 'Proofread', icon: ClipboardCheck },
  { action: 'review', label: 'Review draft', icon: Repeat }
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

// Projects — assignment-driven, no-write scaffold (PRD §8.5). List of
// assignments/capstone/personal; opening one gives a Bardach-step workspace
// where the AI coaches (brainstorm / evidence / stakeholders / proofread /
// review) but never writes the deliverable. Evidence pulls in Notebook pages.
export function Projects(props: { engine: EngineStatus | null }): JSX.Element {
  const { engine } = props
  const [openId, setOpenId] = useState<string | null>(null)

  if (openId) return <Editor id={openId} engine={engine} onBack={() => setOpenId(null)} />
  return <ProjectList onOpen={setOpenId} />
}

function ProjectList({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const [overview, setOverview] = useState<ProjectsOverview | null>(null)
  const [newTitle, setNewTitle] = useState('')

  const refresh = (): void => {
    void window.pgp.projectsOverview().then(setOverview)
  }
  useEffect(refresh, [])

  const openItem = async (item: ProjectListItem): Promise<void> => {
    const p = await window.pgp.openProject(item.id)
    if (p) onOpen(p.id)
  }
  const createPersonal = async (): Promise<void> => {
    const p = await window.pgp.createPersonalProject(newTitle)
    setNewTitle('')
    onOpen(p.id)
  }

  const Card = ({ item }: { item: ProjectListItem }): JSX.Element => {
    const due = dueLabel(item.dueAt)
    return (
      <button className="proj-card" onClick={() => void openItem(item)}>
        <div className="proj-card-top">
          <span className="proj-card-title">{item.title}</span>
          {item.courseCode && <span className="proj-course">{item.courseCode}</span>}
        </div>
        <div className="proj-card-meta">
          <span>{item.deliverable}</span>
          {due && <span className={`proj-due ${due.tone}`}>{due.text}</span>}
        </div>
        {item.started ? (
          <div className="proj-progress" title={`${Math.round(item.progress * 100)}% through the framework`}>
            <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </div>
        ) : (
          <span className="proj-start-hint">Not started — open to begin</span>
        )}
      </button>
    )
  }

  return (
    <div className="surface proj-list">
      <header className="surface-head">
        <h1>Projects</h1>
        <p className="muted">Draft assignments and your capstone with the scholar framework — it coaches, you write.</p>
      </header>

      {!overview ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <section className="proj-group">
            <div className="recents-label">Assignments</div>
            <div className="proj-cards">
              {overview.assignments.length === 0 && <p className="muted small">No assignments yet.</p>}
              {overview.assignments.map((a) => (
                <Card key={a.id} item={a} />
              ))}
            </div>
          </section>

          {overview.capstone && (
            <section className="proj-group">
              <div className="recents-label">Capstone</div>
              <div className="proj-cards">
                <Card item={overview.capstone} />
              </div>
            </section>
          )}

          <section className="proj-group">
            <div className="recents-label">Personal writing</div>
            <div className="proj-cards">
              {overview.personal.map((p) => (
                <Card key={p.id} item={p} />
              ))}
            </div>
            <div className="proj-new">
              <input
                className="input"
                placeholder="New project title (op-ed, Substack post…)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newTitle.trim() && void createPersonal()}
              />
              <button className="btn primary" disabled={!newTitle.trim()} onClick={() => void createPersonal()}>
                <Plus size={15} /> New
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Editor({ id, engine, onBack }: { id: string; engine: EngineStatus | null; onBack: () => void }): JSX.Element {
  const [project, setProject] = useState<Project | null>(null)
  const [draft, setDraft] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [coach, setCoach] = useState<CoachResult | null>(null)
  const [coaching, setCoaching] = useState<CoachAction | null>(null)
  const [showEvidence, setShowEvidence] = useState(false)
  const [pages, setPages] = useState<NotebookPageSummary[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const engineReady = engine?.available ?? false

  useEffect(() => {
    void window.pgp.openProject(id).then((p) => {
      setProject(p)
      setDraft(p?.draft ?? '')
    })
  }, [id])

  const patch = async (p: { title?: string; draft?: string; step?: number; done?: number[] }): Promise<void> => {
    const updated = await window.pgp.updateProject(id, p)
    if (updated) setProject(updated)
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
    const sources: NoteSource[] = []
    const seen = new Set<string>()
    for (const s of page.snippets.flatMap((x) => x.sources)) {
      const key = (s.url || s.title).toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        sources.push(s)
      }
    }
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

  return (
    <div className="proj-editor">
      <div className="proj-ed-head">
        <button className="btn ghost proj-back" onClick={onBack}>
          <ArrowLeft size={16} /> Projects
        </button>
        {project.kind === 'personal' ? (
          <input
            className="nb-title proj-title-input"
            value={project.title}
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

      <div className="proj-banner">
        🛡️ It’s a scaffold, not a shortcut — the AI coaches and proofreads, <strong>you write</strong>. Add your
        anti-plagiarism &amp; AI-use disclaimers on submission.
      </div>

      {project.brief && (
        <details className="proj-brief">
          <summary>Assignment brief</summary>
          <p>{project.brief}</p>
        </details>
      )}

      <div className="proj-body">
        <aside className="proj-steps">
          <div className="recents-label">Bardach’s 8 steps</div>
          <ul>
            {BARDACH_STEPS.map((s, i) => {
              const done = project.done.includes(i)
              const active = project.step === i
              return (
                <li key={s.key}>
                  <button
                    className={`proj-step${active ? ' active' : ''}${done ? ' done' : ''}`}
                    onClick={() => void patch({ step: i })}
                  >
                    <span
                      className={`proj-step-box${done ? ' on' : ''}`}
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
          {step && <div className="proj-lens">India lens · {step.lens}</div>}
        </aside>

        <div className="proj-main">
          <div className="proj-toolbar">
            {COACH_BAR.map(({ action, label, icon: Icon }) => (
              <button
                key={action}
                className="lens-btn"
                disabled={!engineReady || !!coaching}
                onClick={() => void runCoach(action)}
              >
                <Icon size={14} /> {coaching === action ? 'Coaching…' : label}
              </button>
            ))}
            <button className="lens-btn" onClick={openEvidence}>
              <BookMarked size={14} /> Add evidence
            </button>
          </div>

          <textarea
            className="proj-draft"
            placeholder={`Write your ${project.deliverable.toLowerCase().includes('video') ? 'video script' : 'draft'} here — in your own words. The step you’re on: ${step?.title ?? ''}.`}
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
                  <Trash2 size={14} />
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
