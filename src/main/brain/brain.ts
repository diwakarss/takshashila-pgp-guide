import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { SCHEMA_SQL, EMBED_DIM } from './schema'

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
    const threshold = opts.threshold ?? 0.85
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
  async retagCourses(classify: (slug: string, title: string | null) => { code: string; name: string }): Promise<number> {
    const pages = await this.db.query<{ slug: string; title: string | null }>(
      `SELECT slug, title FROM pages WHERE source = 'corpus'`
    )
    let updated = 0
    for (const p of pages.rows) {
      const c = classify(p.slug, p.title)
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
