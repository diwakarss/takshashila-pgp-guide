// Shared IPC contract between the Electron main process and the renderer.
// Both sides import these names so the channel strings never drift.
//
//   renderer  --(invoke CHANNEL)-->  preload bridge  -->  main handler
//   renderer  <--(result)---------  preload bridge  <--  main handler
//
// Keep this file free of Node, DOM, and PGLite imports so both tsconfigs can
// include it. Wire types are declared here (plain) and the main-process
// services map their richer types onto these shapes.

export const IPC = {
  /** Liveness check used by the Phase 0 proof harness. */
  ping: 'app:ping',
  /** Returns app + runtime version info for the debug panel. */
  appInfo: 'app:info',
  /** Page/chunk counts in the local brain. */
  brainStats: 'brain:stats',
  /** Whether a local corpus is available to import, and how big. */
  corpusStatus: 'corpus:status',
  /** Import the local corpus into the brain. Streams progress on the event below. */
  corpusImport: 'corpus:import',
  /** main → renderer: per-file import progress. */
  corpusImportProgress: 'corpus:import:progress',
  /** Semantic search over the brain; returns cited chunks. */
  brainSearch: 'brain:search',
  /** Courses present in the corpus, with lesson counts. */
  corpusCourses: 'corpus:courses',
  /** Which engine is connected and whether it's usable right now. */
  engineStatus: 'engine:status',
  /** Ask the tutor in a thread (new if no threadId); returns the appended turn. */
  tutorAsk: 'tutor:ask',
  /** List saved conversation threads for a tab (Recents). */
  threadsList: 'threads:list',
  /** Load a full thread with its turns. */
  threadGet: 'thread:get',
  /** Delete a thread. */
  threadDelete: 'thread:delete',
  /** Generate a quiz (MCQ + free-form) from a course. */
  quizGenerate: 'quiz:generate',
  /** Grade a free-form quiz answer against the source. */
  quizGrade: 'quiz:grade',
  /** Reuse-only: fetch an existing library illustration for a quiz concept (never generates). */
  quizIllustration: 'quiz:illustration',
  /** Record a completed quiz (score + course) into history; returns updated stats. */
  quizRecord: 'quiz:record',
  /** Scoring history + XP / streak gamification stats. */
  quizStats: 'quiz:stats',
  /** Is on-demand illustration generation available on this machine? */
  illustrationAvailable: 'illustration:available',
  /** Generate (or return cached) one illustration; resolves to a data URL or an error reason. */
  illustrationGenerate: 'illustration:generate'
} as const

export type AppInfo = {
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: string
}

export type Source = 'corpus' | 'private'

export type BrainStats = {
  pages: number
  chunks: number
  bySource: Record<string, number>
}

export type CorpusStatus = {
  hasLocalCorpus: boolean
  dir: string | null
  fileCount: number
}

export type ImportProgress = {
  file: string
  index: number
  total: number
  chunks: number
}

export type ImportResult = { files: number; pages: number; chunks: number }

export type SearchHit = {
  id: string
  slug: string
  source: Source
  ordinal: number
  text: string
  title: string | null
  type: string | null
  courseName: string | null
  score: number
}

export type CourseSummary = { code: string; name: string; lessons: number }

export type AskRequest = { question: string; courseCode?: string; threadId?: string }

export type EngineStatus = {
  id: string
  label: string
  qualityTier: 'high' | 'medium' | 'low'
  available: boolean
}

export type IllustrationSpec = { id: string; title: string; composition: string }

export type Slide = {
  heading: string
  body: string // markdown, with light [n] citations
  illustration: IllustrationSpec | null
}

// A tutor reply is EITHER a slide deck (concept explanation) or plain markdown
// text (a simple question). Both carry corpus citations + follow-up suggestions.
export type TutorReply = {
  kind: 'slides' | 'text'
  slides: Slide[] // populated when kind === 'slides'
  text: string // populated when kind === 'text'
  sources: SearchHit[]
  followups: string[]
  engineId: string
}

export type Turn = { id: string; question: string; answer: TutorReply; createdAt: string }

export type Thread = {
  id: string
  tab: string // 'tutor' (reusable for 'research' later)
  courseCode: string | null
  title: string
  createdAt: string
  updatedAt: string
}

export type ThreadDetail = Thread & { turns: Turn[] }

/** Asking returns the (possibly new) thread id and the appended turn. */
export type AskResult = { threadId: string; turn: Turn }

// ── quiz ────────────────────────────────────────────────────────────────
// Four formats keep recall varied and mostly typing-free:
//  - mcq        one correct of ~4 options
//  - truefalse  a statement to judge (options are ['True','False'])
//  - multi      select ALL that apply (answerIndexes is the correct set)
//  - freeform   short written answer, engine-graded (capped to ~1 in 5)
export type QuizQuestion = {
  id: string
  kind: 'mcq' | 'truefalse' | 'multi' | 'freeform'
  prompt: string
  options: string[] // mcq / truefalse / multi
  answerIndex: number // mcq / truefalse; -1 otherwise
  answerIndexes: number[] // multi only (the correct set); [] otherwise
  modelAnswer: string // free-form only
  explanation: string
  source: string | null // lesson title the question tests
  concept: string // core idea, used to reuse a matching library illustration
}

export type QuizSpec = { courseCode?: string; count?: number }

export type QuizVerdict = { verdict: 'correct' | 'partial' | 'incorrect'; feedback: string }

// ── quiz history + gamification ───────────────────────────────────────────
export type QuizAttempt = {
  id: string
  courseCode: string | null
  courseName: string | null
  total: number
  correct: number // partial free-form answers count as 0.5
  createdAt: string
}

/** What a finished quiz records. */
export type QuizResult = { courseCode?: string; courseName?: string; total: number; correct: number }

export type CourseAccuracy = { courseCode: string | null; courseName: string | null; quizzes: number; accuracy: number }

export type QuizStats = {
  totalQuizzes: number
  totalQuestions: number
  totalCorrect: number // sum across quizzes, partials as 0.5
  accuracy: number // 0..1 overall
  xp: number
  level: number
  levelXp: number // xp earned within the current level
  levelSpan: number // xp needed to clear the current level
  streakDays: number // consecutive days with at least one quiz
  bestStreak: number
  recent: QuizAttempt[] // most-recent first
  byCourse: CourseAccuracy[]
}

/** Either a generated image (dataUrl) or a reason it couldn't be made. */
export type IllustrationImage = {
  id: string
  title: string
  dataUrl?: string
  error?: string
  /** True when generation failed because the image quota/credits are exhausted. */
  quota?: boolean
}
