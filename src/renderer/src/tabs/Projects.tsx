import { useEffect, useRef, useState } from 'react'
import {
  FileText,
  Check,
  Sparkles,
  Trash2,
  BookMarked,
  Copy,
  ChevronLeft,
  ChevronRight,
  X,
  Lightbulb,
  Send,
  Globe,
  Star,
  Save
} from 'lucide-react'
import { Md } from '../components/Markdown'
import { GrowInput } from '../components/GrowInput'
import { planSteps } from '../../../shared/ipc'
import type {
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

// Quick asks per step — each just sends the text into the step's chat.
const STEP_CHIPS: Record<string, string[]> = {
  define: ['Help me narrow it down', 'Is my definition sharp enough?'],
  evidence: ['Find more evidence', 'What data would prove the shifts?'],
  alternatives: ['Give me another angle', 'Which option is strongest?'],
  criteria: ['Which criteria fit this assignment?'],
  outcomes: ['Check my reasoning so far'],
  tradeoffs: ['What am I missing?'],
  decide: ['Stress-test my decision'],
  story: ['Structure my 2-minute script', 'Proofread my draft', 'Review my argument'],
  // explainer plan (analysis assignments)
  frame: ['Show me the non-obvious angles', 'Is my framing sharp enough?'],
  mechanics: ['Check my curve logic', 'What magnitudes am I missing?'],
  angle: ['What would each angle force me to cut?', 'Argue against my favourite']
}

// What the kickoff will do, per step (sets expectations on the button).
const KICKOFF_LABEL: Record<string, string> = {
  define: 'Start — the coach researches the topic and opens the discussion',
  evidence: 'Start — the coach suggests sources worth gathering',
  alternatives: 'Start — the coach proposes candidate angles to weigh',
  criteria: 'Start — the coach proposes judgment criteria to pick from',
  outcomes: 'Start — the coach maps how to project the outcomes',
  tradeoffs: 'Start — the coach sets up the trade-offs to confront',
  decide: 'Start — the coach stress-tests your leaning decision',
  story: 'Start — the coach structures your deliverable with you',
  // explainer plan (analysis assignments)
  frame: 'Start — the coach researches the topic and opens the discussion',
  mechanics: 'Start — the coach maps the shifts and mechanisms to nail down',
  angle: 'Start — the coach lays out the candidate angles and their costs'
}

function dueLabel(dueAt: string | null): { text: string; tone: 'soon' | 'overdue' | 'ok' } | null {
  if (!dueAt) return null
  const due = new Date(dueAt)
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000)
  const date = due.toLocaleDateString([], { month: 'short', day: 'numeric' })
  if (days < 0) return { text: `Overdue · ${date}`, tone: 'overdue' }
  if (days === 0) return { text: `Due today · ${date}`, tone: 'soon' }
  return { text: `Due ${date} · ${days} day${days === 1 ? '' : 's'}`, tone: days <= 3 ? 'soon' : 'ok' }
}

// Projects — a guided, step-by-step workspace (PRD §8.5). Each Bardach step is
// a live discussion with the coach (kickoff does the step's legwork), plus the
// step's own process: evidence collection on step 2, draft versions on step 8.
// The student's takeaways carry forward as context. The AI never writes the
// deliverable.
export function Projects(props: {
  engine: EngineStatus | null
  openId: string | null
  onOpenProject: (id: string | null) => void
  onChanged: () => void
}): JSX.Element {
  const { engine, openId, onOpenProject, onChanged } = props
  if (openId) return <Editor id={openId} engine={engine} onChanged={onChanged} onBack={() => onOpenProject(null)} />
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

  const upNext = overview ? [...overview.assignments].sort((a, b) => ((a.dueAt ?? '9') < (b.dueAt ?? '9') ? -1 : 1)) : []

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
            <strong>Work step by step.</strong> Each step opens a discussion: the coach does the legwork
            (researching the brief, suggesting sources, proposing criteria) and you think it through together.
          </li>
          <li>
            <strong>Mark a step complete</strong> to move on — your takeaways carry forward into the next step.
          </li>
          <li>
            <strong>Finish with your draft.</strong> On the last step you write in your own words, save versions,
            and mark one final — then copy the export with the required disclaimers.
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
function Editor({
  id,
  engine,
  onChanged,
  onBack
}: {
  id: string
  engine: EngineStatus | null
  onChanged: () => void
  onBack: () => void
}): JSX.Element {
  const [project, setProject] = useState<Project | null>(null)
  const [chatBusy, setChatBusy] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [notes, setNotes] = useState('')
  const [draft, setDraft] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [versionName, setVersionName] = useState('')
  const [showEvidence, setShowEvidence] = useState(false)
  const [webTitle, setWebTitle] = useState('')
  const [webUrl, setWebUrl] = useState('')
  const [pages, setPages] = useState<NotebookPageSummary[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [showIntro, setShowIntro] = useState(() => localStorage.getItem('pgp.projIntroSeen') !== '1')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const engineReady = engine?.available ?? false

  useEffect(() => {
    void window.pgp.openProject(id).then((p) => {
      setProject(p)
      setDraft(p?.draft ?? '')
      setNotes(p ? (p.stepData[String(p.step)]?.notes ?? '') : '')
      setSaveState('idle')
    })
  }, [id])

  const steps = planSteps(project?.plan)
  const step = project?.step ?? 0
  const stepKey = project ? (steps[step]?.key ?? steps[0].key) : 'define'
  const stepState = project?.stepData[String(step)] ?? { messages: [], notes: '' }

  // Keep the notes box in sync when the step changes.
  useEffect(() => {
    if (project) setNotes(project.stepData[String(project.step)]?.notes ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.step])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [stepState.messages.length, chatBusy])

  const flash = (msg: string): void => {
    setToast(msg)
    setTimeout(() => setToast(null), 2400)
  }

  const dismissIntro = (): void => {
    localStorage.setItem('pgp.projIntroSeen', '1')
    setShowIntro(false)
  }

  const patch = async (p: Parameters<typeof window.pgp.updateProject>[1]): Promise<void> => {
    const updated = await window.pgp.updateProject(id, p)
    if (updated) setProject(updated)
    onChanged()
  }

  const goToStep = (i: number): void => {
    if (chatBusy) return
    void patch({ step: i })
  }

  const completeStep = (): void => {
    if (!project) return
    const done = project.done.includes(step) ? project.done : [...project.done, step]
    const next = Math.min(step + 1, steps.length - 1)
    void patch({ done, step: next })
  }

  const chat = async (message?: string): Promise<void> => {
    if (!engineReady || chatBusy || !project) return
    setChatBusy(true)
    setChatInput('')
    // Show the user's message immediately while the coach works.
    if (message?.trim()) {
      const key = String(step)
      const cur = project.stepData[key] ?? { messages: [], notes: '' }
      setProject({
        ...project,
        stepData: { ...project.stepData, [key]: { ...cur, messages: [...cur.messages, { role: 'user', text: message.trim() }] } }
      })
    }
    try {
      const updated = await window.pgp.projectChat(id, step, message)
      if (updated) setProject(updated)
    } catch (e) {
      flash(`Coach unavailable: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setChatBusy(false)
    }
  }

  const saveNotes = (next: string): void => {
    setNotes(next)
    if (!project) return
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => {
      const key = String(project.step)
      const cur = project.stepData[key] ?? { messages: [], notes: '' }
      void patch({ stepData: { ...project.stepData, [key]: { ...cur, notes: next } } })
    }, 800)
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

  const saveVersion = async (final: boolean): Promise<void> => {
    const p = await window.pgp.projectSaveVersion(id, versionName, final)
    if (p) setProject(p)
    setVersionName('')
    flash(final ? 'Saved as your final version' : 'Version saved')
  }

  const markFinal = async (draftId: string): Promise<void> => {
    const p = await window.pgp.projectSetFinal(id, draftId)
    if (p) setProject(p)
    flash('Marked as final')
  }

  const openEvidencePicker = (): void => {
    setShowEvidence(true)
    void window.pgp.notebookList().then(setPages)
  }

  const addNotebookEvidence = async (pageId: string): Promise<void> => {
    const page = await window.pgp.notebookGet(pageId)
    if (!page) return
    const sources = dedupe(page.snippets.flatMap((x) => x.sources))
    const updated = await window.pgp.addProjectEvidence(id, {
      title: page.title,
      note: `${page.snippets.length} note${page.snippets.length === 1 ? '' : 's'} from your Notebook`,
      sources,
      pageId
    })
    if (updated) setProject(updated)
    setShowEvidence(false)
  }

  const addWebEvidence = async (): Promise<void> => {
    if (!webUrl.trim()) return
    const title = webTitle.trim() || webUrl.trim()
    const updated = await window.pgp.addProjectEvidence(id, {
      title,
      note: 'web source',
      sources: [{ title, url: webUrl.trim(), kind: 'other' }],
      pageId: null
    })
    if (updated) setProject(updated)
    setWebTitle('')
    setWebUrl('')
  }

  const removeEvidence = async (evidenceId: string): Promise<void> => {
    const updated = await window.pgp.removeProjectEvidence(id, evidenceId)
    if (updated) setProject(updated)
  }

  const copyExport = async (): Promise<void> => {
    if (!project) return
    const finalDraft = project.drafts.find((d) => d.final)
    const text = finalDraft?.text ?? project.draft
    const biblio = dedupe(project.evidence.flatMap((e) => e.sources))
    const lines = [
      `# ${project.title}`,
      project.deliverable ? `_${project.deliverable}_` : '',
      '',
      text.trim() || '_(your draft goes here)_',
      '',
      biblio.length ? '## Sources' : '',
      ...biblio.map((s, i) => `${i + 1}. ${s.title}${s.url ? ` — ${s.url}` : ''}`),
      '',
      '## Disclaimers',
      `Anti-plagiarism: ${ANTI_PLAGIARISM}`,
      `Generative AI: ${AI_DISCLAIMERS[1]}`
    ]
    await navigator.clipboard.writeText(lines.filter((l) => l !== undefined).join('\n'))
    flash(`Export copied${finalDraft ? ` (final: ${finalDraft.title})` : ''}`)
  }

  if (!project) return <p className="muted" style={{ padding: 24 }}>Loading…</p>

  const stepDef = steps[step] ?? steps[0]
  const due = dueLabel(project.dueAt)
  const isLastStep = step >= steps.length - 1
  const isEvidenceStep = stepKey === 'evidence'
  const isStoryStep = stepKey === 'story'

  return (
    <div className="proj-editor">
      <div className="proj-ed-head">
        <button className="btn ghost proj-back" title="All projects" onClick={onBack}>
          <ChevronLeft size={16} /> Projects
        </button>
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
            <strong>How this works:</strong> each step is a discussion — press <em>Start</em> and the coach does
            the legwork, then you think it through together. Jot your takeaway, mark the step complete, and move
            on. On the last step you write your draft (your words, always), save versions, and export with the
            disclaimers.
          </div>
          <button className="icon-btn" title="Got it" onClick={dismissIntro}>
            <X size={15} />
          </button>
        </div>
      )}

      {project.brief && (
        <details className="proj-brief-card" open={stepState.messages.length === 0}>
          <summary className="proj-brief-head">
            <FileText size={15} /> The brief
          </summary>
          <p>{project.brief}</p>
        </details>
      )}

      <div className="proj-body">
        <aside className="proj-steps">
          <div className="recents-label">Your {steps.length} steps</div>
          <ul>
            {steps.map((s, i) => {
              const done = project.done.includes(i)
              const active = step === i
              const talked = (project.stepData[String(i)]?.messages.length ?? 0) > 0
              return (
                <li key={s.key}>
                  <button
                    className={`proj-step${active ? ' active' : ''}${done ? ' done' : ''}`}
                    title={s.guide}
                    onClick={() => goToStep(i)}
                  >
                    <span className={`proj-step-box${done ? ' on' : ''}`}>{done && <Check size={12} />}</span>
                    <span className="proj-step-title">
                      {i + 1}. {s.title}
                    </span>
                    {talked && !done && <span className="proj-step-dot" title="Discussion in progress" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <div className="proj-main">
          <section className="proj-stepguide">
            <div className="proj-stepguide-head">
              <span className="proj-stepguide-label">
                Step {step + 1} of {steps.length} · {stepDef.title}
              </span>
              <span className="proj-lens-chip">India lens · {stepDef.lens}</span>
            </div>
            <p className="proj-stepguide-text">{stepDef.guide}</p>
            <p className="proj-stepguide-done">
              <Check size={13} /> Done when {stepDef.done}.
            </p>
          </section>

          {isEvidenceStep && (
            <section className="proj-collect">
              <div className="recents-label">Your evidence ({project.evidence.length})</div>
              {project.evidence.map((e) => (
                <div key={e.id} className="proj-ev-item">
                  <div className="proj-ev-main">
                    {e.pageId ? <BookMarked size={14} /> : <Globe size={14} />}
                    <span className="proj-ev-title">{e.title}</span>
                    <span className="muted small">
                      {e.note}
                      {e.sources.length > 1 && ` · ${e.sources.length} sources`}
                    </span>
                  </div>
                  <button className="icon-btn" title="Remove" onClick={() => void removeEvidence(e.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <div className="proj-collect-add">
                <button className="lens-btn" onClick={openEvidencePicker}>
                  <BookMarked size={14} /> From my Notebook
                </button>
                <input
                  className="input proj-web-url"
                  placeholder="Paste a web link (https://…)"
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                />
                <input
                  className="input proj-web-title"
                  placeholder="Title (optional)"
                  value={webTitle}
                  onChange={(e) => setWebTitle(e.target.value)}
                />
                <button className="btn" disabled={!webUrl.trim()} onClick={() => void addWebEvidence()}>
                  Add
                </button>
              </div>
            </section>
          )}

          {isStoryStep && (
            <section className="proj-collect">
              <div className="recents-label">Your draft — in your own words</div>
              <textarea
                className="proj-draft"
                placeholder={`Your ${project.deliverable.toLowerCase().includes('video') ? 'video script' : 'draft'}. Start rough — save versions as you refine, then mark one final.`}
                value={draft}
                onChange={(e) => saveDraft(e.target.value)}
              />
              <div className="proj-draft-foot muted small">
                <span>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : ''}</span>
                <span className="proj-version-row">
                  <input
                    className="input proj-version-name"
                    placeholder="Version name (optional)"
                    value={versionName}
                    onChange={(e) => setVersionName(e.target.value)}
                  />
                  <button className="btn" disabled={!draft.trim()} onClick={() => void saveVersion(false)}>
                    <Save size={13} /> Save version
                  </button>
                  <button className="btn primary" disabled={!draft.trim()} onClick={() => void saveVersion(true)}>
                    <Star size={13} /> Save as final
                  </button>
                </span>
              </div>

              {project.drafts.length > 0 && (
                <ul className="proj-versions">
                  {project.drafts.map((d) => (
                    <li key={d.id} className={`proj-version${d.final ? ' final' : ''}`}>
                      <button
                        className="proj-version-load"
                        title="Load into the editor"
                        onClick={() => saveDraft(d.text)}
                      >
                        {d.title}
                      </button>
                      <span className="muted small">
                        {new Date(d.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                      {d.final ? (
                        <span className="proj-final-badge">
                          <Star size={11} /> Final
                        </span>
                      ) : (
                        <button className="nb-showall" onClick={() => void markFinal(d.id)}>
                          Mark final
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <button className="nb-showall proj-export" onClick={() => void copyExport()}>
                <Copy size={12} /> Copy export (final draft + sources + disclaimers)
              </button>
            </section>
          )}

          <section className="pc-chat">
            {stepState.messages.length === 0 && !chatBusy ? (
              <div className="pc-kickoff">
                <p className="muted small">This step starts as a discussion with your coach.</p>
                <button className="btn primary proj-step-next" disabled={!engineReady} onClick={() => void chat()}>
                  <Sparkles size={15} /> {KICKOFF_LABEL[stepKey]}
                </button>
                {!engineReady && <p className="muted small">Your AI isn’t reachable right now.</p>}
              </div>
            ) : (
              <div className="pc-messages">
                {stepState.messages.map((m, i) => (
                  <div key={i} className={`pc-msg ${m.role}`}>
                    {m.role === 'coach' ? (
                      <div className="answer-md">
                        <Md>{m.text}</Md>
                      </div>
                    ) : (
                      m.text
                    )}
                  </div>
                ))}
                {chatBusy && <div className="pc-msg coach muted thinking">Your coach is working…</div>}
                <div ref={chatEndRef} />
              </div>
            )}

            {stepState.messages.length > 0 && !chatBusy && (
              <div className="pc-chips">
                {(STEP_CHIPS[stepKey] ?? []).map((c) => (
                  <button key={c} className="chip" disabled={!engineReady} onClick={() => void chat(c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}

            <div className="ask-row">
              <GrowInput
                placeholder="Discuss this step with your coach…"
                value={chatInput}
                disabled={!engineReady || chatBusy}
                onChange={setChatInput}
                onSubmit={() => void chat(chatInput)}
              />
              <button
                className="btn primary"
                disabled={!engineReady || chatBusy || !chatInput.trim()}
                onClick={() => void chat(chatInput)}
              >
                <Send size={15} />
              </button>
            </div>
          </section>

          {/* The final (script) step's conclusion IS the draft — a separate
              takeaway box there is redundant, and there is no next step to
              carry it into. */}
          {!isStoryStep && (
            <section className="proj-notes">
              <div className="recents-label">Your takeaway from this step (carried into the next)</div>
              <textarea
                className="proj-notes-box"
                placeholder="One or two sentences: what did you conclude here?"
                value={notes}
                onChange={(e) => saveNotes(e.target.value)}
              />
            </section>
          )}

          <div className="proj-stepfoot">
            <button className="btn primary proj-step-next" onClick={completeStep} disabled={chatBusy}>
              {isLastStep ? 'Mark final step done ✓' : (
                <>
                  Mark step complete — next <ChevronRight size={15} />
                </>
              )}
            </button>
            {!isStoryStep && (
              <button className="nb-showall" onClick={() => void copyExport()}>
                <Copy size={12} /> Copy export
              </button>
            )}
          </div>

          <details className="proj-disclaimers">
            <summary>Submission disclaimers (Takshashila policy)</summary>
            <div className="proj-disc-item">
              <p>
                <strong>Anti-plagiarism:</strong> {ANTI_PLAGIARISM}
              </p>
            </div>
            {AI_DISCLAIMERS.map((d, i) => (
              <div key={i} className="proj-disc-item">
                <p>
                  <strong>AI-use option {i + 1}:</strong> {d}
                </p>
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
                    <button className="recent-item" onClick={() => void addNotebookEvidence(p.id)}>
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
