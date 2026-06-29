import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { Brain } from '../brain/brain'
import { nomicEmbedder } from '../embed/embedder'
import { importDirectory, type ImportProgress, type ImportResult } from '../corpus/import'
import type { BrainStats, CorpusStatus, SearchHit } from '../../shared/ipc'

// Owns the brain + embedder for the running app. The renderer reaches this
// only through IPC handlers (registered in main/index.ts). The brain file
// lives in userData so it persists across launches.
class StudyBrainService {
  private brain: Brain | null = null
  private importing = false

  private async open(): Promise<Brain> {
    if (!this.brain) {
      this.brain = await Brain.open(join(app.getPath('userData'), 'brain'))
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

  async importCorpus(onProgress: (p: ImportProgress) => void): Promise<ImportResult> {
    if (this.importing) throw new Error('import already in progress')
    this.importing = true
    try {
      const brain = await this.open()
      return await importDirectory({
        dir: this.corpusDir(),
        embedder: nomicEmbedder,
        writer: brain.corpusWriter,
        onProgress
      })
    } finally {
      this.importing = false
    }
  }

  async search(query: string, limit = 6): Promise<SearchHit[]> {
    const brain = await this.open()
    const q = await nomicEmbedder.embedQuery(query)
    return brain.search(q, { limit })
  }
}

export const studyBrain = new StudyBrainService()
