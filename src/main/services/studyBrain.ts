import { app } from 'electron'
import { join, dirname } from 'node:path'
import { existsSync, readdirSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { Brain, type ConceptRecord } from '../brain/brain'
import { nomicEmbedder } from '../embed/embedder'
import { importDirectory, type ImportProgress, type ImportResult } from '../corpus/import'
import { parsePage } from '../corpus/parse'
import { syncFromRemote, remoteChanges } from '../corpus/remote'
import { getSettings } from './settings'
import { resolveCourse } from '../corpus/course'
import { imageEngine } from '../illustrate/imageEngine'
import { activeEngine } from '../engine/registry'
import { runTutor, summariseReply, type TurnContext } from './tutor'
import { runResearch, runLens, lensTitle } from './research'
import { runCoach, coachTitle, runStepChat } from './projectCoach'
import { generateQuiz, gradeFreeform } from './quiz'
import { xpForAttempt, levelFromXp, currentStreak, bestStreak, dayKey } from './gamify'
import type {
  AskRequest,
  AskResult,
  BrainStats,
  CorpusStatus,
  CourseAccuracy,
  CourseSummary,
  IllustrationImage,
  IllustrationSpec,
  QuizQuestion,
  QuizResult,
  ResearchRequest,
  QuizSpec,
  QuizStats,
  QuizVerdict,
  LensRequest,
  AddSnippetRequest,
  NotebookPage,
  NotebookPageSummary,
  NoteSource,
  Project,
  ProjectListItem,
  ProjectsOverview,
  CoachAction,
  CoachResult,
  CorpusUpdates,
  SearchHit,
  SyncResult,
  Thread,
  ThreadDetail,
  WeakSpot
} from '../../shared/ipc'
import { planSteps } from '../../shared/ipc'

// Pre-loaded assignments (would sync from Open Takshashila later). Opening one
// creates its workspace on first open, keyed by the stable catalog id.
const PROJECT_CATALOG = [
  {
    id: 'pp231-iran-demand-supply',
    kind: 'assignment' as const,
    title: 'Understanding the Shifts in Demand and Supply',
    courseCode: 'PP231',
    courseName: 'Microeconomics I',
    dueAt: '2026-07-10T13:30:00.000Z', // 19:00 IST
    // Analysis explainer, not a policy recommendation → the explainer plan
    // (frame → evidence → mechanics → angle → script), not Bardach.
    plan: 'explainer' as const,
    deliverable: '2-minute video explainer (120s)',
    brief:
      'The ongoing conflict in Iran has disrupted global supply chains, especially energy markets. Identify specific markets or goods where demand and supply curves have shifted as a direct or indirect consequence of the Iran war. Map these shifts and explain the economic mechanisms driving them — moving beyond immediate price changes to consider direct and indirect shifts in demand and supply, broader market repercussions, and macroeconomic spillovers. Submit a 2-minute (120s) video presenting the analysis. Individual work; email to pgp@takshashila.org.in with the anti-plagiarism and AI-use disclaimers.'
  }
]
const CAPSTONE_ITEM = {
  id: 'capstone',
  kind: 'capstone' as const,
  title: 'Capstone',
  courseCode: null,
  courseName: null,
  dueAt: null,
  deliverable: 'Policy document (across the programme)',
  brief: 'Your long-running capstone project. It persists across the whole PGP — build it step by step with the scholar framework.'
}

function makeTitle(question: string): string {
  const t = question.replace(/\s+/g, ' ').trim()
  return t.length > 60 ? t.slice(0, 60) + '…' : t
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

// Owns the brain + embedder for the running app. The renderer reaches this
// only through IPC handlers (registered in main/index.ts). The brain file
// lives in userData so it persists across launches.
class StudyBrainService {
  private brain: Brain | null = null
  private importing = false

  private async open(): Promise<Brain> {
    if (!this.brain) {
      const brain = await Brain.open(join(app.getPath('userData'), 'brain'))
      // Backfill course tags for brains imported before course support existed
      // (cheap, no re-embedding). Idempotent.
      await brain.retagCourses((slug, title, fm) => resolveCourse(fm, slug, title))
      this.brain = brain
      // Warm the embedder in the background so the first query/import isn't a
      // cold start (eng-review D10). Non-blocking.
      void nomicEmbedder.warmup()
    }
    return this.brain
  }

  /**
   * Where the importable corpus lives, in precedence order: PGP_CORPUS_DIR
   * (tests/dev), the builder's local pgp-brain clone (JD's dev flow), else
   * the app-managed mirror in userData that the remote sync fills from the
   * delivery Worker (students).
   */
  corpusDir(): string {
    const override = process.env['PGP_CORPUS_DIR']
    if (override) return override
    const devClone = join(process.cwd(), 'corpus-cache', 'pgp-brain', 'pgp')
    if (existsSync(devClone)) return devClone
    return join(app.getPath('userData'), 'corpus', 'pgp')
  }

  corpusStatus(): CorpusStatus {
    const dir = this.corpusDir()
    if (!existsSync(dir)) return { hasLocalCorpus: false, dir: null, fileCount: 0 }
    const count = readdirSync(dir).filter(
      (f) => f.toLowerCase().endsWith('.md') && f.toLowerCase() !== 'readme.md'
    ).length
    return { hasLocalCorpus: count > 0, dir, fileCount: count }
  }

  async stats(): Promise<BrainStats> {
    const brain = await this.open()
    return brain.stats()
  }

  async importCorpus(
    onProgress: (p: ImportProgress) => void,
    limit?: number,
    incremental = false
  ): Promise<ImportResult> {
    if (this.importing) throw new Error('import already in progress')
    this.importing = true
    try {
      const brain = await this.open()
      const result = await importDirectory({
        dir: this.corpusDir(),
        embedder: nomicEmbedder,
        writer: brain.corpusWriter,
        onProgress,
        limit,
        knownHashes: incremental ? await brain.corpusHashes() : undefined
      })
      // Load any shipped illustration bundle so students get illustrations for
      // free (idempotent; a no-op when there's no bundle, e.g. on the builder).
      try {
        const lib = await this.importLibrary()
        if (lib.concepts > 0) console.log(`[pgp] loaded ${lib.concepts} shipped illustrations (${lib.images} images)`)
      } catch (e) {
        console.error('[pgp] illustration bundle load failed:', e)
      }
      return result
    } finally {
      this.importing = false
    }
  }

  /**
   * Are new classes available? Cheap check for the sidebar badge: fetch the
   * corpus repo (when it's a clone) and count commits behind, plus count local
   * corpus files whose content isn't in the brain yet. No embedding, no writes.
   */
  async corpusUpdates(): Promise<CorpusUpdates> {
    const dir = this.corpusDir()
    const base = dirname(dir)

    let behind = 0
    if (existsSync(join(base, '.git'))) {
      // Builder: network fetch may fail offline — fall back to local-only.
      const fetch = spawnSync('git', ['-C', base, 'fetch', '--quiet'], { encoding: 'utf8', timeout: 20_000 })
      if (fetch.status === 0) {
        const count = spawnSync('git', ['-C', base, 'rev-list', '--count', 'HEAD..@{u}'], {
          encoding: 'utf8',
          timeout: 10_000
        })
        if (count.status === 0) behind = Number(count.stdout.trim()) || 0
      }
    } else {
      // Student: count remote files that differ from the local mirror.
      const key = getSettings().corpusKey
      if (key) {
        try {
          behind = await remoteChanges(base, key)
        } catch {
          /* offline / bad key — the sync button reports errors properly */
        }
      }
    }

    if (!existsSync(dir)) return { pending: 0, behind }
    const known = await (await this.open()).corpusHashes()
    let pending = 0
    for (const f of readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.md') || f.toLowerCase() === 'readme.md') continue
      const page = parsePage(f, readFileSync(join(dir, f), 'utf8'))
      if (known.get(page.slug) !== page.contentHash) pending++
    }
    return { pending, behind }
  }

  /**
   * Weekly class sync: fast-forward the corpus repo (when the corpus dir sits
   * inside a git clone), then import incrementally — unchanged pages are
   * skipped, so only the week's new classes get embedded.
   */
  async syncCorpus(onProgress: (p: ImportProgress) => void): Promise<SyncResult> {
    const base = dirname(this.corpusDir())
    let pull = 'no-repo'
    if (existsSync(join(base, '.git'))) {
      // Builder flow: the corpus dir is a git clone of pgp-brain.
      const res = spawnSync('git', ['-C', base, 'pull', '--ff-only'], { encoding: 'utf8', timeout: 120_000 })
      if (res.status !== 0) {
        throw new Error(`corpus pull failed: ${(res.stderr || res.stdout || '').trim().slice(0, 300)}`)
      }
      pull = /already up to date/i.test(res.stdout) ? 'up-to-date' : 'pulled'
    } else {
      // Student flow: mirror from the delivery Worker with the class passphrase.
      const key = getSettings().corpusKey
      if (key) {
        const r = await syncFromRemote(base, key, (file, index, total) =>
          onProgress({ file, index, total, chunks: 0 })
        )
        pull = r.downloaded > 0 || r.deleted > 0 ? 'pulled' : 'up-to-date'
      }
    }
    const result = await this.importCorpus(onProgress, undefined, true)

    // Retire brain pages whose file is gone from the corpus (deleted classes,
    // replaced duplicates) so they stop surfacing in tutoring and search.
    const dir = this.corpusDir()
    if (existsSync(dir)) {
      const keep = readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.md') && f.toLowerCase() !== 'readme.md')
        .map((f) => parsePage(f, readFileSync(join(dir, f), 'utf8')).slug)
      const pruned = await (await this.open()).pruneCorpus(keep)
      if (pruned > 0) console.log(`[pgp] pruned ${pruned} removed corpus page(s)`)
    }
    return { ...result, pull }
  }

  async courses(): Promise<CourseSummary[]> {
    const brain = await this.open()
    return brain.courses()
  }

  async search(query: string, limit = 6, courseCode?: string): Promise<SearchHit[]> {
    const brain = await this.open()
    const q = await nomicEmbedder.embedQuery(query)
    return brain.search(q, { limit, courseCode })
  }

  // ── conversation ────────────────────────────────────────────────────────

  /** Create an (empty) tutor thread titled from the question, returning its id,
   *  so the UI shows it immediately before the (slower) answer runs into it. */
  async createTutorThread(question: string, courseCode?: string): Promise<{ threadId: string; title: string }> {
    const brain = await this.open()
    const threadId = randomUUID()
    const title = makeTitle(question)
    await brain.createThread({ id: threadId, tab: 'tutor', courseCode: courseCode ?? null, title })
    return { threadId, title }
  }

  /** Ask in a thread (new if no threadId). Loads prior turns as context, runs
   *  the tutor, persists the turn, and returns it. Course is locked per thread. */
  async ask(req: AskRequest): Promise<AskResult> {
    const brain = await this.open()
    let threadId = req.threadId
    let courseCode = req.courseCode
    let history: TurnContext[] = []

    if (threadId) {
      const thread = await brain.getThread(threadId)
      if (thread) {
        courseCode = thread.courseCode ?? undefined // locked to the thread's course
        history = thread.turns.map((t) => ({ question: t.question, summary: summariseReply(t.answer) }))
      }
    } else {
      threadId = randomUUID()
      await brain.createThread({
        id: threadId,
        tab: 'tutor',
        courseCode: courseCode ?? null,
        title: makeTitle(req.question)
      })
    }

    // Hand the tutor the already-drawn concept titles so a matching slide
    // reuses its illustration verbatim instead of regenerating a near-duplicate
    // (embedding matching alone proved too fuzzy — same fix as the quiz).
    const concepts = await brain.listConcepts()
    const conceptTitles = concepts
      .filter((c) => !courseCode || !c.courseCode || c.courseCode === courseCode)
      .map((c) => c.title)
    const reply = await runTutor(
      { question: req.question, courseCode, history },
      { search: (q, l, c) => this.search(q, l, c), engine: activeEngine(), conceptTitles }
    )
    const turn = await brain.appendTurn(threadId, { id: randomUUID(), question: req.question, answer: reply })
    return { threadId, turn }
  }

  /** Create an (empty) research thread titled from the question, and return its
   *  id — so the UI can show the new thread immediately, before the slow web
   *  research runs into it. */
  async createResearchThread(question: string): Promise<{ threadId: string; title: string }> {
    const brain = await this.open()
    const threadId = randomUUID()
    const title = makeTitle(question)
    await brain.createThread({ id: threadId, tab: 'research', courseCode: null, title })
    return { threadId, title }
  }

  /** Ask a web research question in a thread (new if no threadId). Web-first,
   *  no corpus retrieval — a separate conversation space from tutoring. */
  async research(req: ResearchRequest): Promise<AskResult> {
    const brain = await this.open()
    let threadId = req.threadId
    let history: TurnContext[] = []

    if (threadId) {
      const thread = await brain.getThread(threadId)
      if (thread) history = thread.turns.map((t) => ({ question: t.question, summary: summariseReply(t.answer) }))
    } else {
      threadId = randomUUID()
      await brain.createThread({ id: threadId, tab: 'research', courseCode: null, title: makeTitle(req.question) })
    }

    const reply = await runResearch({ question: req.question, history }, { engine: activeEngine() })
    const turn = await brain.appendTurn(threadId, { id: randomUUID(), question: req.question, answer: reply })
    return { threadId, turn }
  }

  /** Generate a structured policy lens for a research topic and append it to the
   *  thread as a lens turn (labelled by the lens title). */
  async researchLens(req: LensRequest): Promise<AskResult> {
    const brain = await this.open()
    const reply = await runLens(
      { question: req.question, lens: req.lens, context: req.context },
      { engine: activeEngine() }
    )
    const turn = await brain.appendTurn(req.threadId, {
      id: randomUUID(),
      question: lensTitle(req.lens),
      answer: reply
    })
    return { threadId: req.threadId, turn }
  }

  // ── notebook ──────────────────────────────────────────────────────────

  async listNotebook(query?: string): Promise<NotebookPageSummary[]> {
    const brain = await this.open()
    return brain.listNotebookPages(query)
  }

  async getNotebookPage(id: string): Promise<NotebookPage | null> {
    const brain = await this.open()
    return brain.getNotebookPage(id)
  }

  async createNotebookPage(title?: string): Promise<NotebookPage> {
    const brain = await this.open()
    return brain.createNotebookPage({ id: randomUUID(), title: (title ?? '').trim() || 'Untitled page' })
  }

  async updateNotebookPage(id: string, fields: { title: string; body: string }): Promise<NotebookPage | null> {
    const brain = await this.open()
    return brain.updateNotebookPage(id, { title: fields.title.trim() || 'Untitled page', body: fields.body })
  }

  async deleteNotebookPage(id: string): Promise<void> {
    const brain = await this.open()
    await brain.deleteNotebookPage(id)
  }

  async updateSnippet(pageId: string, snippetId: string, text: string): Promise<NotebookPage | null> {
    const brain = await this.open()
    return brain.updateSnippet(pageId, snippetId, text)
  }

  async deleteSnippet(pageId: string, snippetId: string): Promise<NotebookPage | null> {
    const brain = await this.open()
    return brain.deleteSnippet(pageId, snippetId)
  }

  // ── projects ──────────────────────────────────────────────────────────

  async projectsOverview(): Promise<ProjectsOverview> {
    const brain = await this.open()
    const started = await brain.listProjects()
    const byId = new Map(started.map((p) => [p.id, p]))
    const toItem = (base: (typeof PROJECT_CATALOG)[number] | typeof CAPSTONE_ITEM): ProjectListItem => {
      const p = byId.get(base.id)
      return {
        id: base.id,
        kind: base.kind,
        title: p?.title ?? base.title,
        courseCode: base.courseCode,
        courseName: base.courseName,
        dueAt: base.dueAt,
        deliverable: base.deliverable,
        started: !!p,
        progress: p ? p.done.length / planSteps(p.plan).length : 0,
        updatedAt: p?.updatedAt ?? null
      }
    }
    const personal: ProjectListItem[] = started
      .filter((p) => p.kind === 'personal')
      .map((p) => ({
        id: p.id,
        kind: 'personal',
        title: p.title,
        courseCode: p.courseCode,
        courseName: p.courseName,
        dueAt: p.dueAt,
        deliverable: p.deliverable,
        started: true,
        progress: p.done.length / planSteps(p.plan).length,
        updatedAt: p.updatedAt
      }))
    return { assignments: PROJECT_CATALOG.map(toItem), capstone: toItem(CAPSTONE_ITEM), personal }
  }

  /** Open (creating on first open from the catalog) a project by id. */
  async openProject(id: string): Promise<Project | null> {
    const brain = await this.open()
    const existing = await brain.getProject(id)
    if (existing) return existing
    const cat = [...PROJECT_CATALOG, CAPSTONE_ITEM].find((c) => c.id === id)
    if (!cat) return null
    return brain.createProject({
      id: cat.id,
      kind: cat.kind,
      title: cat.title,
      courseCode: cat.courseCode,
      courseName: cat.courseName,
      dueAt: cat.dueAt,
      brief: cat.brief,
      deliverable: cat.deliverable,
      plan: 'plan' in cat ? cat.plan : 'bardach'
    })
  }

  async createPersonalProject(title: string): Promise<Project> {
    const brain = await this.open()
    return brain.createProject({
      id: randomUUID(),
      kind: 'personal',
      title: title.trim() || 'Untitled project',
      courseCode: null,
      courseName: null,
      dueAt: null,
      brief: '',
      deliverable: 'Personal writing'
    })
  }

  async updateProject(
    id: string,
    patch: {
      title?: string
      draft?: string
      step?: number
      done?: number[]
      stepData?: Project['stepData']
    }
  ): Promise<Project | null> {
    const brain = await this.open()
    return brain.updateProject(id, patch)
  }

  /** One turn of the guided per-step chat. No message = kickoff: the coach does
   *  the step's legwork (researching the brief, suggesting sources…) and opens
   *  the discussion. The exchange is persisted on the project. */
  async projectChat(id: string, step: number, message?: string): Promise<Project | null> {
    const brain = await this.open()
    const p = await brain.getProject(id)
    if (!p) return null
    const key = String(step)
    const cur = p.stepData[key] ?? { messages: [], notes: '' }
    const history = [...cur.messages]
    if (message?.trim()) history.push({ role: 'user', text: message.trim() })
    const reply = await runStepChat(p, step, history, activeEngine())
    const stepData = { ...p.stepData, [key]: { ...cur, messages: [...history, { role: 'coach' as const, text: reply }] } }
    return brain.updateProject(id, { stepData })
  }

  /** Snapshot the working draft as a stored version; final replaces any prior final. */
  async saveDraftVersion(id: string, title?: string, final = false): Promise<Project | null> {
    const brain = await this.open()
    const p = await brain.getProject(id)
    if (!p || !p.draft.trim()) return p
    const version = {
      id: randomUUID(),
      title: (title ?? '').trim() || `Draft ${p.drafts.length + 1}`,
      text: p.draft,
      final,
      createdAt: new Date().toISOString()
    }
    let drafts = [...p.drafts, version]
    if (final) drafts = drafts.map((d) => ({ ...d, final: d.id === version.id }))
    return brain.updateProject(id, { drafts })
  }

  async setFinalDraft(id: string, draftId: string): Promise<Project | null> {
    const brain = await this.open()
    const p = await brain.getProject(id)
    if (!p) return null
    return brain.updateProject(id, { drafts: p.drafts.map((d) => ({ ...d, final: d.id === draftId })) })
  }

  async addProjectEvidence(
    id: string,
    ev: { title: string; note: string; sources: NoteSource[]; pageId: string | null }
  ): Promise<Project | null> {
    const brain = await this.open()
    const p = await brain.getProject(id)
    if (!p) return null
    return brain.updateProject(id, {
      evidence: [...p.evidence, { id: randomUUID(), title: ev.title, note: ev.note, sources: ev.sources, pageId: ev.pageId }]
    })
  }

  async removeProjectEvidence(id: string, evidenceId: string): Promise<Project | null> {
    const brain = await this.open()
    const p = await brain.getProject(id)
    if (!p) return null
    return brain.updateProject(id, { evidence: p.evidence.filter((e) => e.id !== evidenceId) })
  }

  async deleteProject(id: string): Promise<void> {
    const brain = await this.open()
    await brain.deleteProject(id)
  }

  async projectCoach(id: string, action: CoachAction): Promise<CoachResult> {
    const brain = await this.open()
    const p = await brain.getProject(id)
    if (!p) return { action, title: coachTitle(action), markdown: 'Open a project first.', blocked: true }
    return runCoach(p, action, activeEngine())
  }

  /** Capture a highlight into an existing page, or a new one when newTitle is
   *  given. Returns the page the snippet landed on. */
  async addSnippet(req: AddSnippetRequest): Promise<NotebookPage | null> {
    const brain = await this.open()
    let pageId = req.pageId
    if (!pageId) {
      const title = (req.newTitle ?? '').trim() || makeTitle(req.text)
      const page = await brain.createNotebookPage({ id: randomUUID(), title })
      pageId = page.id
    }
    return brain.appendSnippet(pageId, {
      id: randomUUID(),
      text: req.text.trim(),
      sources: req.sources,
      from: req.from,
      createdAt: new Date().toISOString()
    })
  }

  async listThreads(tab = 'tutor'): Promise<Thread[]> {
    const brain = await this.open()
    return brain.listThreads(tab)
  }

  async getThread(id: string): Promise<ThreadDetail | null> {
    const brain = await this.open()
    return brain.getThread(id)
  }

  async deleteThread(id: string): Promise<void> {
    const brain = await this.open()
    await brain.deleteThread(id)
  }

  // ── quiz ──────────────────────────────────────────────────────────────

  async generateQuiz(spec: QuizSpec): Promise<QuizQuestion[]> {
    const brain = await this.open()
    // Hand the engine the titles of illustrations we already have so it can key
    // questions to them (exact title) — those images are reused on the reveal.
    const concepts = await brain.listConcepts()
    const conceptTitles = concepts
      .filter((c) => !spec.courseCode || !c.courseCode || c.courseCode === spec.courseCode)
      .map((c) => c.title)
    return generateQuiz(spec, { search: (q, l, c) => this.search(q, l, c), engine: activeEngine(), conceptTitles })
  }

  async gradeQuizAnswer(question: { prompt: string; modelAnswer: string }, answer: string): Promise<QuizVerdict> {
    return gradeFreeform(question, answer, activeEngine())
  }

  /** Record a finished quiz and return the freshly-updated stats (so the UI can
   *  show XP earned / level / streak on the results screen in one round-trip). */
  async recordQuiz(result: QuizResult): Promise<QuizStats> {
    const brain = await this.open()
    await brain.recordQuizAttempt({
      id: randomUUID(),
      courseCode: result.courseCode ?? null,
      courseName: result.courseName ?? null,
      total: result.total,
      correct: result.correct
    })
    // Per-question outcomes (keyed by lesson) feed weak-spot review.
    const answers = (result.answers ?? []).filter((a) => a.topic?.trim())
    if (answers.length > 0) {
      await brain.recordTopicReviews(
        answers.map((a) => ({
          id: randomUUID(),
          courseCode: a.courseCode ?? result.courseCode ?? null,
          topic: a.topic.trim(),
          correct: a.correct
        }))
      )
    }
    return this.quizStats()
  }

  /** Weakest lessons to review, optionally scoped to a course. */
  async weakSpots(courseCode?: string): Promise<WeakSpot[]> {
    const brain = await this.open()
    return brain.weakSpots({ courseCode })
  }

  /** Wipe quiz history (dev verification; a Settings "reset progress" later). */
  async clearQuizHistory(): Promise<void> {
    const brain = await this.open()
    await brain.clearQuizAttempts()
  }

  /** Scoring history + XP / streak gamification, derived from the attempt log. */
  async quizStats(): Promise<QuizStats> {
    const brain = await this.open()
    const attempts = await brain.listQuizAttempts()
    const totalQuizzes = attempts.length
    const totalQuestions = attempts.reduce((s, a) => s + a.total, 0)
    const totalCorrect = attempts.reduce((s, a) => s + a.correct, 0)
    const xp = attempts.reduce((s, a) => s + xpForAttempt(a.correct, a.total), 0)
    const { level, levelXp, levelSpan } = levelFromXp(xp)

    const days = attempts.map((a) => dayKey(new Date(a.createdAt)))
    const today = dayKey(new Date())

    // Per-course rollup (accuracy weighted by questions), most-taken first.
    const byCourseMap = new Map<string, CourseAccuracy & { correct: number; questions: number }>()
    for (const a of attempts) {
      const key = a.courseCode ?? '∅'
      const cur =
        byCourseMap.get(key) ??
        { courseCode: a.courseCode, courseName: a.courseName, quizzes: 0, accuracy: 0, correct: 0, questions: 0 }
      cur.quizzes += 1
      cur.correct += a.correct
      cur.questions += a.total
      if (!cur.courseName && a.courseName) cur.courseName = a.courseName
      byCourseMap.set(key, cur)
    }
    const byCourse: CourseAccuracy[] = [...byCourseMap.values()]
      .map((c) => ({
        courseCode: c.courseCode,
        courseName: c.courseName,
        quizzes: c.quizzes,
        accuracy: c.questions > 0 ? c.correct / c.questions : 0
      }))
      .sort((a, b) => b.quizzes - a.quizzes)

    return {
      totalQuizzes,
      totalQuestions,
      totalCorrect,
      accuracy: totalQuestions > 0 ? totalCorrect / totalQuestions : 0,
      xp,
      level,
      levelXp,
      levelSpan,
      streakDays: currentStreak(days, today),
      bestStreak: bestStreak(days),
      recent: attempts.slice(0, 8),
      byCourse
    }
  }

  /**
   * Resolve a slide's illustration: reuse a library concept if one matches
   * (instant, free), otherwise generate it once, save it to the library, and
   * return it. Concept-keyed by embedding, so the same idea is never redrawn.
   */
  async resolveIllustration(spec: IllustrationSpec, courseCode?: string): Promise<IllustrationImage> {
    const brain = await this.open()
    // Exact-title reuse first (the tutor is steered to copy library titles
    // verbatim) — deterministic and skips the embedder roundtrip entirely.
    const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const exact = (await brain.listConcepts()).find((c) => norm(c.title) === norm(spec.title))
    if (exact) {
      const dataUrl = imageEngine.read(exact.imageFile)
      if (dataUrl) return { id: spec.id, title: exact.title, dataUrl }
    }
    const emb = await nomicEmbedder.embedQuery(spec.title)
    const match = await brain.matchConcept(emb, { courseCode })
    if (match) {
      const dataUrl = imageEngine.read(match.imageFile)
      if (dataUrl) return { id: spec.id, title: spec.title, dataUrl }
    }
    // Shipped/student builds never generate: a library miss is just a miss,
    // even if a stray OpenAI key sits on the machine. Generation is a
    // builder-only capability (dev, or explicit opt-in).
    if (!this.imageGenEnabled()) {
      return { id: spec.id, title: spec.title, error: 'not in the illustration library' }
    }
    if (!imageEngine.isAvailable()) {
      return { id: spec.id, title: spec.title, error: 'image generator not available' }
    }
    try {
      const { dataUrl, file } = await imageEngine.generate(spec.title, spec.composition)
      await brain.upsertConcept({
        key: slugify(spec.title) || `concept-${Date.now()}`,
        title: spec.title,
        courseCode: courseCode ?? null,
        description: spec.title,
        composition: spec.composition,
        imageFile: file,
        embedding: emb
      })
      return { id: spec.id, title: spec.title, dataUrl }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const quota = /429|quota|billing|insufficient|exceeded/i.test(msg)
      return { id: spec.id, title: spec.title, error: msg, quota }
    }
  }

  /**
   * Reuse-only illustration lookup for quizzes: if a library concept already
   * matches this idea, return its image. NEVER generates (quizzes stay free and
   * instant). Returns an error reason when nothing matches.
   */
  async reuseIllustration(concept: string, _courseCode?: string): Promise<IllustrationImage> {
    const term = concept.trim()
    if (!term) return { id: 'quiz', title: concept, error: 'no concept' }
    const brain = await this.open()
    // Deterministic: the quiz engine keyed each question to an exact library
    // title (or none), so match on the normalised title — no wrong images, no
    // generation. Ignore courseCode here: a concept title is course-unique.
    const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const target = norm(term)
    const hit = (await brain.listConcepts()).find((c) => norm(c.title) === target)
    if (hit) {
      const dataUrl = imageEngine.read(hit.imageFile)
      if (dataUrl) return { id: hit.key, title: hit.title, dataUrl }
    }
    return { id: 'quiz', title: concept, error: 'no matching illustration' }
  }

  async conceptCount(): Promise<number> {
    const brain = await this.open()
    return brain.conceptCount()
  }

  async clearLibrary(): Promise<void> {
    const brain = await this.open()
    await brain.clearConcepts()
  }

  async listConcepts(): Promise<{ key: string; title: string; courseCode: string | null; imageFile: string }[]> {
    const brain = await this.open()
    return brain.listConcepts()
  }

  illustrationsDir(): string {
    return join(app.getPath('userData'), 'illustrations')
  }

  /**
   * Whether this build may GENERATE new illustrations. Off by default in a
   * packaged (student) build so a library miss never spends image credits;
   * on in dev, or with an explicit opt-in. `PGP_DISABLE_IMAGE_GEN=1` forces it
   * off even in dev (used to smoke-test the student experience).
   */
  imageGenEnabled(): boolean {
    if (process.env['PGP_DISABLE_IMAGE_GEN'] === '1') return false
    if (process.env['PGP_ENABLE_IMAGE_GEN'] === '1') return true
    return !app.isPackaged
  }

  /** Where the shippable illustration bundle lives — a sibling of the corpus
   *  markdown dir, so it travels with the corpus repo (images + concepts.json). */
  private libraryBundleDir(): string {
    return join(dirname(this.corpusDir()), 'illustrations')
  }

  /**
   * Publish the concept library into the corpus bundle: copy every image and
   * write concepts.json (key, title, course, composition, image_file, and the
   * EMBEDDING). Students import this so their app reuses the same illustrations
   * with no image generation. Builder-only.
   */
  async publishLibrary(): Promise<{ concepts: number; images: number; dir: string }> {
    const brain = await this.open()
    const concepts = await brain.exportConcepts()
    const bundle = this.libraryBundleDir()
    const imagesDir = join(bundle, 'images')
    mkdirSync(imagesDir, { recursive: true })
    let images = 0
    for (const c of concepts) {
      const src = join(this.illustrationsDir(), c.imageFile)
      if (existsSync(src)) {
        copyFileSync(src, join(imagesDir, c.imageFile))
        images++
      }
    }
    writeFileSync(join(bundle, 'concepts.json'), JSON.stringify(concepts, null, 2))
    return { concepts: concepts.length, images, dir: bundle }
  }

  /**
   * Load a shipped illustration bundle (if present) into this install: copy the
   * images into the local illustrations dir and upsert the concepts (with their
   * shipped embeddings — no re-embedding). Idempotent. Called after import so a
   * student gets illustrations for free.
   */
  async importLibrary(): Promise<{ concepts: number; images: number }> {
    const bundle = this.libraryBundleDir()
    const manifest = join(bundle, 'concepts.json')
    if (!existsSync(manifest)) return { concepts: 0, images: 0 }
    let concepts: ConceptRecord[]
    try {
      concepts = JSON.parse(readFileSync(manifest, 'utf8')) as ConceptRecord[]
    } catch {
      return { concepts: 0, images: 0 }
    }
    const brain = await this.open()
    const destDir = this.illustrationsDir()
    mkdirSync(destDir, { recursive: true })
    let images = 0
    let loaded = 0
    for (const c of concepts) {
      if (!c.imageFile || !Array.isArray(c.embedding)) continue
      const src = join(bundle, 'images', c.imageFile)
      if (existsSync(src)) {
        copyFileSync(src, join(destDir, c.imageFile))
        images++
      }
      await brain.upsertConcept(c)
      loaded++
    }
    return { concepts: loaded, images }
  }

  async lessonTitles(courseCode: string): Promise<string[]> {
    const brain = await this.open()
    return brain.courseLessonTitles(courseCode)
  }
}

export const studyBrain = new StudyBrainService()
