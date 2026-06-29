import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { SCHEMA_SQL, EMBED_DIM } from './schema'

export type Source = 'corpus' | 'private'

export type PageRecord = {
  slug: string
  type?: string | null
  title?: string | null
  frontmatter?: Record<string, unknown> | null
  markdown?: string | null
  contentHash?: string | null
  capturedAt?: string | null
}

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
    opts: { limit?: number; source?: Source } = {}
  ): Promise<SearchHit[]> {
    const limit = opts.limit ?? 8
    const qlit = toVectorLiteral(queryEmbedding)
    const where = opts.source ? `WHERE c.source = $2` : ''
    const params: unknown[] = opts.source ? [qlit, opts.source] : [qlit]
    // `<=>` is cosine distance in pgvector; similarity = 1 - distance.
    const res = await this.db.query<{
      id: string
      slug: string
      source: Source
      ordinal: number
      text: string
      title: string | null
      type: string | null
      distance: number
    }>(
      `SELECT c.id, c.slug, c.source, c.ordinal, c.text,
              p.title, p.type,
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
      score: 1 - Number(r.distance)
    }))
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
        `INSERT INTO pages (slug, source, type, title, frontmatter, markdown, content_hash, captured_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (slug) DO UPDATE SET
           source = EXCLUDED.source, type = EXCLUDED.type, title = EXCLUDED.title,
           frontmatter = EXCLUDED.frontmatter, markdown = EXCLUDED.markdown,
           content_hash = EXCLUDED.content_hash, captured_at = EXCLUDED.captured_at,
           updated_at = now()`,
        [
          page.slug,
          this.source,
          page.type ?? null,
          page.title ?? null,
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
