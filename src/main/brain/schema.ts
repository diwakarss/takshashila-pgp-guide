// Brain schema. One PGLite database, two logical sources:
//   'corpus'  — shared course content, sync-managed, freely replaced
//   'private' — the student's own notes/projects, NEVER touched by corpus sync
//
// The source column is the spine of the write-fence (eng-review D3): corpus
// writes are scoped to source='corpus' and can't address private rows.
//
//   pages ──< chunks (embedded, vector-searched)
//     └─────< edges  (## Related [[wikilinks]])

export const EMBED_DIM = 768 // nomic-embed-text-v1.5

export const SCHEMA_SQL = /* sql */ `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS pages (
  slug         TEXT PRIMARY KEY,
  source       TEXT NOT NULL CHECK (source IN ('corpus', 'private')),
  type         TEXT,
  title        TEXT,
  frontmatter  JSONB,
  markdown     TEXT,
  content_hash TEXT,
  captured_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id        TEXT PRIMARY KEY,
  slug      TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  source    TEXT NOT NULL CHECK (source IN ('corpus', 'private')),
  ordinal   INT  NOT NULL,
  text      TEXT NOT NULL,
  embedding vector(${EMBED_DIM})
);

CREATE TABLE IF NOT EXISTS edges (
  from_slug TEXT NOT NULL,
  to_slug   TEXT NOT NULL,
  source    TEXT NOT NULL CHECK (source IN ('corpus', 'private')),
  PRIMARY KEY (from_slug, to_slug)
);

CREATE INDEX IF NOT EXISTS chunks_source_idx ON chunks (source);
CREATE INDEX IF NOT EXISTS pages_source_idx  ON pages (source);
`
// Note: no ANN index yet. At Phase 0 scale (~2 courses, low thousands of
// chunks) exact cosine scan is sub-millisecond. HNSW vs IVFFlat is an
// eng-D10 measured decision deferred until the corpus is large.
