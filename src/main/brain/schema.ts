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
  course_code  TEXT,
  course_name  TEXT,
  frontmatter  JSONB,
  markdown     TEXT,
  content_hash TEXT,
  captured_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade brains created before course columns existed (no re-import needed;
-- retagCourses() backfills the values from the slug classifier).
ALTER TABLE pages ADD COLUMN IF NOT EXISTS course_code TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS course_name TEXT;

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

-- Conversations: persistent threads of tutoring turns (private, never uploaded).
-- 'tab' lets the same model back Research threads later. answer is a JSON blob
-- ({kind:'slides'|'text', slides?|text?, sources, followups}) so a thread
-- re-renders on reload without re-asking the model.
CREATE TABLE IF NOT EXISTS threads (
  id          TEXT PRIMARY KEY,
  tab         TEXT NOT NULL,
  course_code TEXT,
  title       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS turns (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  ordinal    INT  NOT NULL,
  question   TEXT NOT NULL,
  answer     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS turns_thread_idx  ON turns (thread_id, ordinal);
CREATE INDEX IF NOT EXISTS threads_tab_idx   ON threads (tab, updated_at DESC);

-- Quiz history: one row per completed quiz. Feeds scoring history + the XP /
-- streak gamification. Private, never uploaded. correct counts partial
-- free-form answers as 0.5, so it can be fractional.
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id          TEXT PRIMARY KEY,
  course_code TEXT,
  course_name TEXT,
  total       INT  NOT NULL,
  correct     REAL NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_attempts_time_idx ON quiz_attempts (created_at DESC);

-- Per-question outcomes, keyed by the lesson (topic) each question tested. Feeds
-- weak-spot review: lessons with low accuracy / not seen recently resurface.
-- correct is 1 / 0.5 / 0.
CREATE TABLE IF NOT EXISTS topic_reviews (
  id          TEXT PRIMARY KEY,
  course_code TEXT,
  topic       TEXT NOT NULL,
  correct     REAL NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS topic_reviews_topic_idx ON topic_reviews (topic);

-- Notebook: the student's own titled note pages (private, never uploaded). Each
-- page has free-form notes (body) plus captured snippets (highlights carried in
-- from Research/Tutor) as a JSONB array, each snippet keeping its source(s) so
-- the page can render a bibliography and later feed Projects.
CREATE TABLE IF NOT EXISTS notebook_pages (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  snippets   JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notebook_updated_idx ON notebook_pages (updated_at DESC);

-- Projects: assignment / capstone / personal writing workspaces (private). The
-- scaffold (Bardach steps + draft + pulled-in evidence) is stored; the draft is
-- always the student's own words — the AI coaches, it does not ghostwrite.
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  course_code TEXT,
  course_name TEXT,
  due_at      TIMESTAMPTZ,
  brief       TEXT NOT NULL DEFAULT '',
  deliverable TEXT NOT NULL DEFAULT '',
  draft       TEXT NOT NULL DEFAULT '',
  step        INT  NOT NULL DEFAULT 0,
  done        JSONB NOT NULL DEFAULT '[]',
  evidence    JSONB NOT NULL DEFAULT '[]',
  step_data   JSONB NOT NULL DEFAULT '{}',
  drafts      JSONB NOT NULL DEFAULT '[]',
  plan        TEXT NOT NULL DEFAULT 'bardach',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_updated_idx ON projects (updated_at DESC);
-- Upgrade projects created before the guided flow existed.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS step_data JSONB NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS drafts JSONB NOT NULL DEFAULT '[]';
-- Upgrade projects created before per-assignment step plans existed.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'bardach';

-- Illustration library: one row per drawn concept. Matched by embedding so a
-- concept is drawn ONCE and reused across questions/phrasings (no per-answer
-- regeneration). Ships with the corpus so students get illustrations for free.
CREATE TABLE IF NOT EXISTS concepts (
  key         TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  course_code TEXT,
  description TEXT,
  composition TEXT,
  image_file  TEXT NOT NULL,
  embedding   vector(${EMBED_DIM})
);
`
// Note: no ANN index yet. At Phase 0 scale (~2 courses, low thousands of
// chunks) exact cosine scan is sub-millisecond. HNSW vs IVFFlat is an
// eng-D10 measured decision deferred until the corpus is large.
