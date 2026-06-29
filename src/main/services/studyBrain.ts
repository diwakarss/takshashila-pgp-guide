import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { Brain } from '../brain/brain'
import { nomicEmbedder } from '../embed/embedder'
import { importDirectory, type ImportProgress, type ImportResult } from '../corpus/import'
import { classifyCourse } from '../corpus/course'
import { imageEngine } from '../illustrate/imageEngine'
import type {
  BrainStats,
  CorpusStatus,
  CourseSummary,
  IllustrationImage,
  IllustrationSpec,
  SearchHit
} from '../../shared/ipc'

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
      return await importDirectory({
        dir: this.corpusDir(),
        embedder: nomicEmbedder,
        writer: brain.corpusWriter,
        onProgress,
        limit
      })
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

  async conceptCount(): Promise<number> {
    const brain = await this.open()
    return brain.conceptCount()
  }
}

export const studyBrain = new StudyBrainService()
