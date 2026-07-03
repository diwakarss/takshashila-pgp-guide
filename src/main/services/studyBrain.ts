import { app } from 'electron'
import { join, dirname } from 'node:path'
import { existsSync, readdirSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Brain, type ConceptRecord } from '../brain/brain'
import { nomicEmbedder } from '../embed/embedder'
import { importDirectory, type ImportProgress, type ImportResult } from '../corpus/import'
import { classifyCourse } from '../corpus/course'
import { imageEngine } from '../illustrate/imageEngine'
import { agentCliEngine } from '../engine/agentCli'
import { runTutor, summariseReply, type TurnContext } from './tutor'
import { generateQuiz, gradeFreeform } from './quiz'
import type {
  AskRequest,
  AskResult,
  BrainStats,
  CorpusStatus,
  CourseSummary,
  IllustrationImage,
  IllustrationSpec,
  QuizQuestion,
  QuizSpec,
  QuizVerdict,
  SearchHit,
  Thread,
  ThreadDetail
} from '../../shared/ipc'

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
      await brain.retagCourses(classifyCourse)
      this.brain = brain
      // Warm the embedder in the background so the first query/import isn't a
      // cold start (eng-review D10). Non-blocking.
      void nomicEmbedder.warmup()
    }
    return this.brain
  }

  /**
   * Where the importable corpus lives. Dev: the gitignored local clone of
   * pgp-brain. Overridable via PGP_CORPUS_DIR. (The gated-Worker sync that
   * replaces this clone is a later phase.)
   */
  corpusDir(): string {
    const override = process.env['PGP_CORPUS_DIR']
    if (override) return override
    return join(process.cwd(), 'corpus-cache', 'pgp-brain', 'pgp')
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

  async importCorpus(onProgress: (p: ImportProgress) => void, limit?: number): Promise<ImportResult> {
    if (this.importing) throw new Error('import already in progress')
    this.importing = true
    try {
      const brain = await this.open()
      const result = await importDirectory({
        dir: this.corpusDir(),
        embedder: nomicEmbedder,
        writer: brain.corpusWriter,
        onProgress,
        limit
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

    const reply = await runTutor(
      { question: req.question, courseCode, history },
      { search: (q, l, c) => this.search(q, l, c), engine: agentCliEngine }
    )
    const turn = await brain.appendTurn(threadId, { id: randomUUID(), question: req.question, answer: reply })
    return { threadId, turn }
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
    return generateQuiz(spec, { search: (q, l, c) => this.search(q, l, c), engine: agentCliEngine, conceptTitles })
  }

  async gradeQuizAnswer(question: { prompt: string; modelAnswer: string }, answer: string): Promise<QuizVerdict> {
    return gradeFreeform(question, answer, agentCliEngine)
  }

  /**
   * Resolve a slide's illustration: reuse a library concept if one matches
   * (instant, free), otherwise generate it once, save it to the library, and
   * return it. Concept-keyed by embedding, so the same idea is never redrawn.
   */
  async resolveIllustration(spec: IllustrationSpec, courseCode?: string): Promise<IllustrationImage> {
    const brain = await this.open()
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
