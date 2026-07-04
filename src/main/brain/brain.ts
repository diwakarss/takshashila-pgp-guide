import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { SCHEMA_SQL, EMBED_DIM } from './schema'
import type {
  NoteSnippet,
  NotebookPage,
  NotebookPageSummary,
  Project,
  ProjectDraftVersion,
  ProjectEvidence,
  ProjectStepState,
  QuizAttempt,
  Thread,
  ThreadAnswer,
  ThreadDetail,
  Turn,
  WeakSpot
} from '../../shared/ipc'

export type Source = 'corpus' | 'private'

export type PageRecord = {
  slug: string
  type?: string | null
  title?: string | null
  courseCode?: string | null
  courseName?: string | null
  frontmatter?: Record<string, unknown> | null
  markdown?: string | null
  contentHash?: string | null
  capturedAt?: string | null
}

export type CourseSummary = { code: string; name: string; lessons: number }

export type ConceptRecord = {
  key: string
  title: string
  courseCode?: string | null
  description?: string | null
  composition?: string | null
  imageFile: string
  embedding: number[]
}

export type ConceptMatch = { key: string; title: string; imageFile: string; score: number }

export type ChunkRecord = {
  ordinal: number
  text: string
  embedding: number[]
}

export type SearchHit = {
  id: string
  slug: string
  source: Source
  ordinal: number
  text: string
  title: string | null
  type: string | null
  courseName: string | null
  score: number // cosine similarity in [0,1], higher = closer
}

// pgvector wants a literal like '[0.1,0.2,...]'. Build it once per vector.
function toVectorLiteral(v: number[]): string {
  if (v.length !== EMBED_DIM) {
    throw new Error(`embedding has ${v.length} dims, expected ${EMBED_DIM}`)
  }
  return `[${v.join(',')}]`
}

/**
 * The local study brain. One PGLite file, two sources. All reads can span
 * both sources; writes are always source-scoped. Corpus sync only ever goes
 * through {@link corpusWriter}, which hardcodes source='corpus' — so a sync
 * bug physically cannot mutate the student's private pages (eng-review D3).
 */
export class Brain {
  private db: PGlite
  private constructor(db: PGlite) {
    this.db = db
  }

  /** Open (or create) a brain at `dataDir`. Pass ':memory:' style by omitting
   *  dataDir for an ephemeral in-memory brain (used by tests). */
  static async open(dataDir?: string): Promise<Brain> {
    const db = dataDir
      ? new PGlite(dataDir, { extensions: { vector } })
      : new PGlite({ extensions: { vector } })
    await db.waitReady
    await db.exec(SCHEMA_SQL)
    return new Brain(db)
  }

  async close(): Promise<void> {
    await this.db.close()
  }

  /** A writer locked to a single source. The only way to write pages/chunks/
   *  edges — there is no un-scoped write path. */
  writer(source: Source): SourceWriter {
    return new SourceWriter(this.db, source)
  }

  /** Convenience: the corpus-scoped writer used by import + sync. */
  get corpusWriter(): SourceWriter {
    return this.writer('corpus')
  }

  /** Nearest chunks to a query embedding, by cosine similarity. Optionally
   *  restrict to one source; default searches both. */
  async search(
    queryEmbedding: number[],
    opts: { limit?: number; source?: Source; courseCode?: string } = {}
  ): Promise<SearchHit[]> {
    const limit = opts.limit ?? 8
    const qlit = toVectorLiteral(queryEmbedding)
    const conds: string[] = []
    const params: unknown[] = [qlit]
    if (opts.source) {
      params.push(opts.source)
      conds.push(`c.source = $${params.length}`)
    }
    if (opts.courseCode) {
      params.push(opts.courseCode)
      conds.push(`p.course_code = $${params.length}`)
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    // `<=>` is cosine distance in pgvector; similarity = 1 - distance.
    const res = await this.db.query<{
      id: string
      slug: string
      source: Source
      ordinal: number
      text: string
      title: string | null
      type: string | null
      course_name: string | null
      distance: number
    }>(
      `SELECT c.id, c.slug, c.source, c.ordinal, c.text,
              p.title, p.type, p.course_name,
              (c.embedding <=> $1) AS distance
         FROM chunks c
         JOIN pages p ON p.slug = c.slug
         ${where}
        ORDER BY c.embedding <=> $1
        LIMIT ${limit}`,
      params
    )
    return res.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      source: r.source,
      ordinal: r.ordinal,
      text: r.text,
      title: r.title,
      type: r.type,
      courseName: r.course_name,
      score: 1 - Number(r.distance)
    }))
  }

  /** Nearest drawn concept to a query embedding, if close enough. Optionally
   *  prefer the same course. Returns null when nothing is similar enough. */
  async matchConcept(
    queryEmbedding: number[],
    opts: { threshold?: number; courseCode?: string } = {}
  ): Promise<ConceptMatch | null> {
    const threshold = opts.threshold ?? 0.9
    const qlit = toVectorLiteral(queryEmbedding)
    const res = await this.db.query<{ key: string; title: string; image_file: string; distance: number }>(
      `SELECT key, title, image_file, (embedding <=> $1) AS distance
         FROM concepts
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1
        LIMIT 1`,
      [qlit]
    )
    const row = res.rows[0]
    if (!row) return null
    const score = 1 - Number(row.distance)
    return score >= threshold ? { key: row.key, title: row.title, imageFile: row.image_file, score } : null
  }

  /** Add (or replace) a drawn concept in the library. */
  async upsertConcept(c: ConceptRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO concepts (key, title, course_code, description, composition, image_file, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO UPDATE SET
         title = EXCLUDED.title, course_code = EXCLUDED.course_code, description = EXCLUDED.description,
         composition = EXCLUDED.composition, image_file = EXCLUDED.image_file, embedding = EXCLUDED.embedding`,
      [
        c.key,
        c.title,
        c.courseCode ?? null,
        c.description ?? null,
        c.composition ?? null,
        c.imageFile,
        toVectorLiteral(c.embedding)
      ]
    )
  }

  /** How many concepts are in the library. */
  async conceptCount(): Promise<number> {
    const r = await this.db.query<{ count: number }>(`SELECT count(*)::int AS count FROM concepts`)
    return r.rows[0]?.count ?? 0
  }

  /** Wipe the concept library (e.g. after a style change, to force regen). */
  async clearConcepts(): Promise<void> {
    await this.db.query(`DELETE FROM concepts`)
  }

  /** Full concept rows including embeddings — used to publish the library into
   *  the corpus bundle so student installs get illustrations without any image
   *  generation. `embedding::text` yields a JSON-parseable '[..]' literal. */
  async exportConcepts(): Promise<ConceptRecord[]> {
    const r = await this.db.query<{
      key: string
      title: string
      course_code: string | null
      description: string | null
      composition: string | null
      image_file: string
      embedding: string | null
    }>(
      `SELECT key, title, course_code, description, composition, image_file, embedding::text AS embedding
         FROM concepts ORDER BY key`
    )
    return r.rows
      .filter((row) => row.embedding)
      .map((row) => ({
        key: row.key,
        title: row.title,
        courseCode: row.course_code,
        description: row.description,
        composition: row.composition,
        imageFile: row.image_file,
        embedding: JSON.parse(row.embedding as string) as number[]
      }))
  }

  /** List concepts (metadata only) — used to back up the library before a regen. */
  async listConcepts(): Promise<{ key: string; title: string; courseCode: string | null; imageFile: string }[]> {
    const r = await this.db.query<{ key: string; title: string; course_code: string | null; image_file: string }>(
      `SELECT key, title, course_code, image_file FROM concepts ORDER BY course_code, title`
    )
    return r.rows.map((c) => ({ key: c.key, title: c.title, courseCode: c.course_code, imageFile: c.image_file }))
  }

  /** Distinct lesson titles for a course — input to concept extraction. */
  async courseLessonTitles(courseCode: string): Promise<string[]> {
    const r = await this.db.query<{ title: string }>(
      `SELECT DISTINCT title FROM pages
        WHERE source = 'corpus' AND course_code = $1 AND title IS NOT NULL
        ORDER BY title`,
      [courseCode]
    )
    return r.rows.map((x) => x.title)
  }

  // ── quiz history (private; never uploaded) ──────────────────────────────

  async recordQuizAttempt(a: {
    id: string
    courseCode: string | null
    courseName: string | null
    total: number
    correct: number
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO quiz_attempts (id, course_code, course_name, total, correct)
       VALUES ($1, $2, $3, $4, $5)`,
      [a.id, a.courseCode, a.courseName, a.total, a.correct]
    )
  }

  /** All quiz attempts, most-recent first. Small (one row per finished quiz),
   *  so the gamification service aggregates over the full set in memory. */
  async listQuizAttempts(): Promise<QuizAttempt[]> {
    const r = await this.db.query<{
      id: string
      course_code: string | null
      course_name: string | null
      total: number
      correct: number
      created_at: string
    }>(
      `SELECT id, course_code, course_name, total, correct, created_at
         FROM quiz_attempts ORDER BY created_at DESC`
    )
    return r.rows.map((x) => ({
      id: x.id,
      courseCode: x.course_code,
      courseName: x.course_name,
      total: Number(x.total),
      correct: Number(x.correct),
      createdAt: x.created_at
    }))
  }

  /** Record per-question outcomes (keyed by lesson) for weak-spot review. */
  async recordTopicReviews(
    rows: { id: string; courseCode: string | null; topic: string; correct: number }[]
  ): Promise<void> {
    for (const r of rows) {
      await this.db.query(
        `INSERT INTO topic_reviews (id, course_code, topic, correct) VALUES ($1, $2, $3, $4)`,
        [r.id, r.courseCode, r.topic, r.correct]
      )
    }
  }

  /** The weakest lessons: lowest accuracy first, then least-recently seen. Only
   *  returns topics below `maxAccuracy` (a genuine weak spot), optionally scoped
   *  to a course. */
  async weakSpots(opts: { courseCode?: string; limit?: number; maxAccuracy?: number } = {}): Promise<WeakSpot[]> {
    const limit = opts.limit ?? 6
    const maxAccuracy = opts.maxAccuracy ?? 0.85
    const params: unknown[] = [maxAccuracy]
    let scope = ''
    if (opts.courseCode) {
      params.push(opts.courseCode)
      scope = `WHERE course_code = $${params.length}`
    }
    const r = await this.db.query<{ topic: string; course_code: string | null; seen: number; accuracy: number }>(
      `SELECT topic, course_code, count(*)::int AS seen, avg(correct) AS accuracy
         FROM topic_reviews
         ${scope}
        GROUP BY topic, course_code
       HAVING avg(correct) < $1
        ORDER BY avg(correct) ASC, max(created_at) ASC
        LIMIT ${limit}`,
      params
    )
    return r.rows.map((x) => ({
      topic: x.topic,
      courseCode: x.course_code,
      seen: Number(x.seen),
      accuracy: Number(x.accuracy)
    }))
  }

  /** Wipe quiz history (dev/verification cleanup + a Settings reset later). */
  async clearQuizAttempts(): Promise<void> {
    await this.db.query(`DELETE FROM quiz_attempts`)
    await this.db.query(`DELETE FROM topic_reviews`)
  }

  // ── notebook pages (private; never uploaded) ────────────────────────────

  private parseSnippets(raw: unknown): NoteSnippet[] {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(arr) ? (arr as NoteSnippet[]) : []
  }

  /** Pages (metadata only) matching an optional query over title/body/snippets. */
  async listNotebookPages(query?: string): Promise<NotebookPageSummary[]> {
    const params: unknown[] = []
    let where = ''
    if (query && query.trim()) {
      params.push(`%${query.trim()}%`)
      where = `WHERE title ILIKE $1 OR body ILIKE $1 OR snippets::text ILIKE $1`
    }
    const r = await this.db.query<{ id: string; title: string; snippets: unknown; updated_at: string }>(
      `SELECT id, title, snippets, updated_at FROM notebook_pages ${where} ORDER BY updated_at DESC`,
      params
    )
    return r.rows.map((p) => ({
      id: p.id,
      title: p.title,
      snippets: this.parseSnippets(p.snippets).length,
      updatedAt: String(p.updated_at)
    }))
  }

  async getNotebookPage(id: string): Promise<NotebookPage | null> {
    const r = await this.db.query<{
      id: string
      title: string
      body: string
      snippets: unknown
      created_at: string
      updated_at: string
    }>(`SELECT * FROM notebook_pages WHERE id = $1`, [id])
    const p = r.rows[0]
    if (!p) return null
    return {
      id: p.id,
      title: p.title,
      body: p.body,
      snippets: this.parseSnippets(p.snippets),
      createdAt: String(p.created_at),
      updatedAt: String(p.updated_at)
    }
  }

  async createNotebookPage(page: { id: string; title: string }): Promise<NotebookPage> {
    await this.db.query(`INSERT INTO notebook_pages (id, title) VALUES ($1, $2)`, [page.id, page.title])
    return (await this.getNotebookPage(page.id)) as NotebookPage
  }

  async updateNotebookPage(id: string, fields: { title: string; body: string }): Promise<NotebookPage | null> {
    await this.db.query(`UPDATE notebook_pages SET title = $2, body = $3, updated_at = now() WHERE id = $1`, [
      id,
      fields.title,
      fields.body
    ])
    return this.getNotebookPage(id)
  }

  /** Append a captured snippet to a page (snippet id supplied by the caller). */
  async appendSnippet(pageId: string, snippet: NoteSnippet): Promise<NotebookPage | null> {
    const page = await this.getNotebookPage(pageId)
    if (!page) return null
    const snippets = [...page.snippets, snippet]
    await this.db.query(`UPDATE notebook_pages SET snippets = $2, updated_at = now() WHERE id = $1`, [
      pageId,
      JSON.stringify(snippets)
    ])
    return this.getNotebookPage(pageId)
  }

  async updateSnippet(pageId: string, snippetId: string, text: string): Promise<NotebookPage | null> {
    const page = await this.getNotebookPage(pageId)
    if (!page) return null
    const snippets = page.snippets.map((s) => (s.id === snippetId ? { ...s, text } : s))
    await this.db.query(`UPDATE notebook_pages SET snippets = $2, updated_at = now() WHERE id = $1`, [
      pageId,
      JSON.stringify(snippets)
    ])
    return this.getNotebookPage(pageId)
  }

  async deleteSnippet(pageId: string, snippetId: string): Promise<NotebookPage | null> {
    const page = await this.getNotebookPage(pageId)
    if (!page) return null
    const snippets = page.snippets.filter((s) => s.id !== snippetId)
    await this.db.query(`UPDATE notebook_pages SET snippets = $2, updated_at = now() WHERE id = $1`, [
      pageId,
      JSON.stringify(snippets)
    ])
    return this.getNotebookPage(pageId)
  }

  async deleteNotebookPage(id: string): Promise<void> {
    await this.db.query(`DELETE FROM notebook_pages WHERE id = $1`, [id])
  }

  // ── projects (private; never uploaded) ──────────────────────────────────

  private rowToProject(p: {
    id: string
    kind: string
    title: string
    course_code: string | null
    course_name: string | null
    due_at: string | null
    brief: string
    deliverable: string
    draft: string
    step: number
    done: unknown
    evidence: unknown
    step_data?: unknown
    drafts?: unknown
    created_at: string
    updated_at: string
  }): Project {
    const parse = <T>(v: unknown, fallback: T): T => {
      const val = typeof v === 'string' ? JSON.parse(v) : v
      return (val ?? fallback) as T
    }
    return {
      id: p.id,
      kind: p.kind as Project['kind'],
      title: p.title,
      courseCode: p.course_code,
      courseName: p.course_name,
      dueAt: p.due_at ? String(p.due_at) : null,
      brief: p.brief,
      deliverable: p.deliverable,
      draft: p.draft,
      step: Number(p.step),
      done: parse<number[]>(p.done, []),
      evidence: parse<ProjectEvidence[]>(p.evidence, []),
      stepData: parse<Record<string, ProjectStepState>>(p.step_data, {}),
      drafts: parse<ProjectDraftVersion[]>(p.drafts, []),
      createdAt: String(p.created_at),
      updatedAt: String(p.updated_at)
    }
  }

  async listProjects(): Promise<Project[]> {
    const r = await this.db.query(`SELECT * FROM projects ORDER BY updated_at DESC`)
    return (r.rows as Parameters<typeof this.rowToProject>[0][]).map((row) => this.rowToProject(row))
  }

  async getProject(id: string): Promise<Project | null> {
    const r = await this.db.query(`SELECT * FROM projects WHERE id = $1`, [id])
    const row = r.rows[0] as Parameters<typeof this.rowToProject>[0] | undefined
    return row ? this.rowToProject(row) : null
  }

  async createProject(p: {
    id: string
    kind: string
    title: string
    courseCode: string | null
    courseName: string | null
    dueAt: string | null
    brief: string
    deliverable: string
  }): Promise<Project> {
    await this.db.query(
      `INSERT INTO projects (id, kind, title, course_code, course_name, due_at, brief, deliverable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.kind, p.title, p.courseCode, p.courseName, p.dueAt, p.brief, p.deliverable]
    )
    return (await this.getProject(p.id)) as Project
  }

  async updateProject(
    id: string,
    patch: {
      title?: string
      draft?: string
      step?: number
      done?: number[]
      evidence?: ProjectEvidence[]
      stepData?: Record<string, ProjectStepState>
      drafts?: ProjectDraftVersion[]
    }
  ): Promise<Project | null> {
    const cur = await this.getProject(id)
    if (!cur) return null
    const next = {
      title: patch.title ?? cur.title,
      draft: patch.draft ?? cur.draft,
      step: patch.step ?? cur.step,
      done: patch.done ?? cur.done,
      evidence: patch.evidence ?? cur.evidence,
      stepData: patch.stepData ?? cur.stepData,
      drafts: patch.drafts ?? cur.drafts
    }
    await this.db.query(
      `UPDATE projects SET title=$2, draft=$3, step=$4, done=$5, evidence=$6, step_data=$7, drafts=$8, updated_at=now() WHERE id=$1`,
      [
        id,
        next.title,
        next.draft,
        next.step,
        JSON.stringify(next.done),
        JSON.stringify(next.evidence),
        JSON.stringify(next.stepData),
        JSON.stringify(next.drafts)
      ]
    )
    return this.getProject(id)
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.query(`DELETE FROM projects WHERE id = $1`, [id])
  }

  // ── conversation threads (private; never uploaded) ──────────────────────

  async createThread(t: { id: string; tab: string; courseCode: string | null; title: string }): Promise<void> {
    await this.db.query(
      `INSERT INTO threads (id, tab, course_code, title) VALUES ($1, $2, $3, $4)`,
      [t.id, t.tab, t.courseCode, t.title]
    )
  }

  async listThreads(tab: string): Promise<Thread[]> {
    const r = await this.db.query<{
      id: string
      tab: string
      course_code: string | null
      title: string
      created_at: string
      updated_at: string
    }>(`SELECT * FROM threads WHERE tab = $1 ORDER BY updated_at DESC`, [tab])
    return r.rows.map((t) => ({
      id: t.id,
      tab: t.tab,
      courseCode: t.course_code,
      title: t.title,
      createdAt: String(t.created_at),
      updatedAt: String(t.updated_at)
    }))
  }

  private async turnsOf(threadId: string): Promise<Turn[]> {
    const r = await this.db.query<{ id: string; question: string; answer: ThreadAnswer; created_at: string }>(
      `SELECT id, question, answer, created_at FROM turns WHERE thread_id = $1 ORDER BY ordinal`,
      [threadId]
    )
    return r.rows.map((t) => ({
      id: t.id,
      question: t.question,
      answer: typeof t.answer === 'string' ? (JSON.parse(t.answer) as ThreadAnswer) : t.answer,
      createdAt: String(t.created_at)
    }))
  }

  async getThread(id: string): Promise<ThreadDetail | null> {
    const r = await this.db.query<{
      id: string
      tab: string
      course_code: string | null
      title: string
      created_at: string
      updated_at: string
    }>(`SELECT * FROM threads WHERE id = $1`, [id])
    const t = r.rows[0]
    if (!t) return null
    return {
      id: t.id,
      tab: t.tab,
      courseCode: t.course_code,
      title: t.title,
      createdAt: String(t.created_at),
      updatedAt: String(t.updated_at),
      turns: await this.turnsOf(id)
    }
  }

  /** Append a turn and bump the thread's updated_at, atomically. */
  async appendTurn(threadId: string, turn: { id: string; question: string; answer: ThreadAnswer }): Promise<Turn> {
    return this.db.transaction(async (tx) => {
      const ord = await tx.query<{ next: number }>(
        `SELECT COALESCE(max(ordinal), -1) + 1 AS next FROM turns WHERE thread_id = $1`,
        [threadId]
      )
      const ordinal = ord.rows[0]?.next ?? 0
      const res = await tx.query<{ created_at: string }>(
        `INSERT INTO turns (id, thread_id, ordinal, question, answer)
         VALUES ($1, $2, $3, $4, $5) RETURNING created_at`,
        [turn.id, threadId, ordinal, turn.question, JSON.stringify(turn.answer)]
      )
      await tx.query(`UPDATE threads SET updated_at = now() WHERE id = $1`, [threadId])
      return { id: turn.id, question: turn.question, answer: turn.answer, createdAt: String(res.rows[0]?.created_at) }
    })
  }

  async deleteThread(id: string): Promise<void> {
    await this.db.query(`DELETE FROM threads WHERE id = $1`, [id])
  }

  /** List the courses present in the corpus, with lesson counts. */
  async courses(): Promise<CourseSummary[]> {
    const res = await this.db.query<{ code: string | null; name: string | null; lessons: number }>(
      `SELECT course_code AS code, course_name AS name, count(*)::int AS lessons
         FROM pages WHERE source = 'corpus' AND course_code IS NOT NULL
        GROUP BY course_code, course_name
        ORDER BY lessons DESC`
    )
    return res.rows
      .filter((r): r is { code: string; name: string; lessons: number } => !!r.code && !!r.name)
      .map((r) => ({ code: r.code, name: r.name, lessons: r.lessons }))
  }

  /** Backfill course_code/name for every corpus page using `classify`. Cheap
   *  (no re-embedding) — used to upgrade brains imported before courses. */
  async retagCourses(
    classify: (slug: string, title: string | null, frontmatter: Record<string, unknown> | null) => { code: string; name: string }
  ): Promise<number> {
    const pages = await this.db.query<{ slug: string; title: string | null; frontmatter: unknown }>(
      `SELECT slug, title, frontmatter FROM pages WHERE source = 'corpus'`
    )
    let updated = 0
    for (const p of pages.rows) {
      const fm = (typeof p.frontmatter === 'string' ? JSON.parse(p.frontmatter) : p.frontmatter) as Record<
        string,
        unknown
      > | null
      const c = classify(p.slug, p.title, fm ?? null)
      await this.db.query(`UPDATE pages SET course_code = $1, course_name = $2 WHERE slug = $3`, [
        c.code,
        c.name,
        p.slug
      ])
      updated++
    }
    return updated
  }

  async stats(): Promise<{ pages: number; chunks: number; bySource: Record<string, number> }> {
    const pages = await this.db.query<{ count: number }>(`SELECT count(*)::int AS count FROM pages`)
    const chunks = await this.db.query<{ count: number }>(`SELECT count(*)::int AS count FROM chunks`)
    const bySrc = await this.db.query<{ source: string; count: number }>(
      `SELECT source, count(*)::int AS count FROM pages GROUP BY source`
    )
    const bySource: Record<string, number> = {}
    for (const r of bySrc.rows) bySource[r.source] = r.count
    return { pages: pages.rows[0]?.count ?? 0, chunks: chunks.rows[0]?.count ?? 0, bySource }
  }
}

/** Source-scoped write surface. Every write here carries this writer's source;
 *  callers cannot target a different one. */
export class SourceWriter {
  constructor(
    private db: PGlite,
    readonly source: Source
  ) {}

  /** Insert or replace a page and its chunks atomically, scoped to this
   *  writer's source. Replaces existing chunks for the slug. */
  async upsertPage(page: PageRecord, chunks: ChunkRecord[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO pages (slug, source, type, title, course_code, course_name, frontmatter, markdown, content_hash, captured_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (slug) DO UPDATE SET
           source = EXCLUDED.source, type = EXCLUDED.type, title = EXCLUDED.title,
           course_code = EXCLUDED.course_code, course_name = EXCLUDED.course_name,
           frontmatter = EXCLUDED.frontmatter, markdown = EXCLUDED.markdown,
           content_hash = EXCLUDED.content_hash, captured_at = EXCLUDED.captured_at,
           updated_at = now()`,
        [
          page.slug,
          this.source,
          page.type ?? null,
          page.title ?? null,
          page.courseCode ?? null,
          page.courseName ?? null,
          page.frontmatter ? JSON.stringify(page.frontmatter) : null,
          page.markdown ?? null,
          page.contentHash ?? null,
          page.capturedAt ?? null
        ]
      )
      await tx.query(`DELETE FROM chunks WHERE slug = $1`, [page.slug])
      for (const ch of chunks) {
        await tx.query(
          `INSERT INTO chunks (id, slug, source, ordinal, text, embedding)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [`${page.slug}#${ch.ordinal}`, page.slug, this.source, ch.ordinal, ch.text, toVectorLiteral(ch.embedding)]
        )
      }
    })
  }

  /** Record a `## Related` edge, scoped to this source. */
  async upsertEdge(fromSlug: string, toSlug: string): Promise<void> {
    await this.db.query(
      `INSERT INTO edges (from_slug, to_slug, source) VALUES ($1, $2, $3)
       ON CONFLICT (from_slug, to_slug) DO NOTHING`,
      [fromSlug, toSlug, this.source]
    )
  }
}
