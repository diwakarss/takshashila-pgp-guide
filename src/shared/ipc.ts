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
  /** Create (and title) a tutor thread up-front, before the answer runs. */
  tutorStart: 'tutor:start',
  /** Ask the tutor in a thread (new if no threadId); returns the appended turn. */
  tutorAsk: 'tutor:ask',
  /** Create (and title) a research thread up-front, before the slow search runs. */
  researchStart: 'research:start',
  /** Ask a web research question in a thread (new if no threadId). */
  researchAsk: 'research:ask',
  /** Generate a structured policy lens (stakeholder map / two sides / evidence / timeline). */
  researchLens: 'research:lens',
  /** Notebook: list/search pages, load one, create, edit, capture a snippet, delete. */
  notebookList: 'notebook:list',
  notebookGet: 'notebook:get',
  notebookCreate: 'notebook:create',
  notebookUpdate: 'notebook:update',
  notebookAddSnippet: 'notebook:add',
  notebookUpdateSnippet: 'notebook:snippet:update',
  notebookDeleteSnippet: 'notebook:snippet:delete',
  notebookDelete: 'notebook:delete',
  /** Projects: the assignment/capstone/personal scaffold (no-write coaching). */
  projectsOverview: 'projects:overview',
  projectOpen: 'projects:open',
  projectCreatePersonal: 'projects:createPersonal',
  projectUpdate: 'projects:update',
  projectAddEvidence: 'projects:evidence:add',
  projectRemoveEvidence: 'projects:evidence:remove',
  projectDelete: 'projects:delete',
  projectCoach: 'projects:coach',
  /** Per-step guided chat with the coach (kickoff when no message given). */
  projectChat: 'projects:chat',
  /** Snapshot the working draft as a stored version (optionally the final). */
  projectSaveVersion: 'projects:draft:save',
  projectSetFinal: 'projects:draft:final',
  /** Persisted app settings (onboarding flag, engine choice, metrics opt-in). */
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
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
  /** Weakest lessons (lowest accuracy / least recently seen) to review. */
  quizWeakSpots: 'quiz:weakspots',
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

// ── research (web-first, policy-focused) ──────────────────────────────────
export type SourceType = 'government' | 'data' | 'academic' | 'thinktank' | 'news' | 'other'

export type ResearchSource = {
  n: number
  title: string
  url: string
  type: SourceType
  date?: string // publication date, YYYY or YYYY-MM, when known
}

// A research answer: a cited synthesis over web sources (numbered, type-graded),
// with policy-oriented follow-ups. No corpus dependency, no illustrations.
export type ResearchReply = {
  kind: 'research'
  synthesis: string // markdown with inline [n] citations
  sources: ResearchSource[]
  followups: string[]
  engineId: string
}

export type ResearchRequest = { question: string; threadId?: string }

// Structured policy lenses — on-demand analysis primitives over a research
// topic. Each maps to a Bardach step and later flows into Projects.
export type LensKind = 'stakeholders' | 'twosides' | 'evidence' | 'timeline'

export type LensTable = { columns: string[]; rows: string[][] }

export type LensReply = {
  kind: 'lens'
  lens: LensKind
  title: string
  intro: string // 1-2 sentence framing
  table?: LensTable // stakeholders / evidence / timeline
  sides?: { for: string[]; against: string[] } // twosides
  sources: ResearchSource[]
  engineId: string
}

export type LensRequest = { threadId: string; question: string; lens: LensKind; context?: string }

// A turn's answer is a tutor reply (slides/text), a research reply, or a
// structured lens — all persisted in the same thread store, discriminated by `kind`.
export type ThreadAnswer = TutorReply | ResearchReply | LensReply

export type Turn = { id: string; question: string; answer: ThreadAnswer; createdAt: string }

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

export type QuizSpec = { courseCode?: string; count?: number; focusTopics?: string[] }

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

/** One answered question's outcome, keyed by the lesson it tested (for weak-spot
 *  review). correct is 1 / 0.5 / 0. */
export type QuizAnswerOutcome = { topic: string; courseCode?: string; correct: number }

/** What a finished quiz records. */
export type QuizResult = {
  courseCode?: string
  courseName?: string
  total: number
  correct: number
  answers?: QuizAnswerOutcome[]
}

/** A lesson you've been getting wrong or haven't revisited — a review target. */
export type WeakSpot = { topic: string; courseCode: string | null; seen: number; accuracy: number }

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

// ── notebook (the connective tissue: Research → Notebook → Projects) ───────
// A carried source keeps enough to render a bibliography entry + link back.
export type NoteSource = { title: string; url?: string; kind: string } // kind: SourceType | 'research' | 'corpus'

// A captured highlight, with the sources it references and where it came from.
export type NoteSnippet = { id: string; text: string; sources: NoteSource[]; from: string; createdAt: string }

export type NotebookPage = {
  id: string
  title: string
  body: string // the student's own notes (markdown), editable
  snippets: NoteSnippet[]
  createdAt: string
  updatedAt: string
}

export type NotebookPageSummary = { id: string; title: string; snippets: number; updatedAt: string }

/** Capture a highlight: into an existing page (pageId) or a new one (newTitle). */
export type AddSnippetRequest = {
  pageId?: string
  newTitle?: string
  text: string
  sources: NoteSource[]
  from: string
}

// ── projects (no-write scaffold: assignments · capstone · personal) ────────
export type ProjectKind = 'assignment' | 'capstone' | 'personal'

// Bardach's 8-step policy analysis: each step carries a plain-language guide
// (what the student should actually DO) and a Takshashila India-lens hint.
// Static UI + prompt content shared by main (coach prompts) and renderer.
export const BARDACH_STEPS = [
  {
    key: 'define',
    title: 'Define the problem',
    guide:
      'Write ONE sharp, provisional sentence: what’s wrong, for whom, and roughly how big. Rough estimates are fine here — this is the hypothesis that aims your research; step 2 is where you verify it. Not "energy prices are affected" but "diesel prices seem to have risen sharply, squeezing Indian freight".',
    lens: 'Is this a state-capacity problem?'
  },
  {
    key: 'evidence',
    title: 'Assemble evidence',
    guide:
      'Now prove it — or correct it. Gather the data and sources that verify the magnitudes you assumed in step 1, trace the causes, and stock up citable evidence for the later steps. If the evidence contradicts your definition, go back and sharpen it — that’s the method working.',
    lens: 'What does the data actually say?'
  },
  {
    key: 'alternatives',
    title: 'Construct alternatives',
    guide:
      'List 3–4 realistic courses of action (or, for an explainer: the markets/angles you could analyse). Always include "let present trends continue" as the baseline to compare against.',
    lens: 'Union / State / Concurrent?'
  },
  {
    key: 'criteria',
    title: 'Select criteria',
    guide:
      'Decide how you’ll judge the alternatives — e.g. effectiveness, cost, equity, feasibility. Write them down; they’re what makes your analysis an argument instead of an opinion.',
    lens: 'Better-or-worse, not good-or-bad'
  },
  {
    key: 'outcomes',
    title: 'Project the outcomes',
    guide:
      'For each alternative, predict what would actually happen — with magnitudes and mechanisms (who responds, how, why). This is the hardest and most honest step; don’t skip the uncomfortable numbers.',
    lens: 'All sectors can fail'
  },
  {
    key: 'tradeoffs',
    title: 'Confront the trade-offs',
    guide:
      'No option wins on every criterion. Spell out what you gain and what you give up between the front-runners — who benefits, who bears the cost.',
    lens: 'Who bears the cost?'
  },
  {
    key: 'decide',
    title: 'Decide',
    guide:
      'Commit to a position. Test it: could you defend it to a sceptic using only the evidence you assembled in step 2? If not, go back.',
    lens: 'Defensible on the evidence?'
  },
  {
    key: 'story',
    title: 'Tell your story',
    guide:
      'Turn the analysis into a clear narrative for your audience — for this deliverable, your script or draft. Lead with the answer, then the mechanism, then the evidence. Plain words beat jargon.',
    lens: 'Clear to a non-expert?'
  }
] as const

export type ProjectEvidence = { id: string; title: string; note: string; sources: NoteSource[]; pageId: string | null }

// The guided flow: each step carries its own coach conversation + the student's
// takeaway notes (which feed forward as context into later steps).
export type ProjectMsg = { role: 'user' | 'coach'; text: string }
export type ProjectStepState = { messages: ProjectMsg[]; notes: string }

/** A stored draft version (final step); one may be marked as the final. */
export type ProjectDraftVersion = { id: string; title: string; text: string; final: boolean; createdAt: string }

export type Project = {
  id: string
  kind: ProjectKind
  title: string
  courseCode: string | null
  courseName: string | null
  dueAt: string | null
  brief: string // the assignment prompt / description
  deliverable: string // e.g. "2-minute video explainer"
  draft: string // the student's own working draft (never AI-written)
  step: number // active Bardach step index
  done: number[] // completed step indices
  evidence: ProjectEvidence[]
  stepData: Record<string, ProjectStepState> // keyed by step index
  drafts: ProjectDraftVersion[]
  createdAt: string
  updatedAt: string
}

export type ProjectListItem = {
  id: string
  kind: ProjectKind
  title: string
  courseCode: string | null
  courseName: string | null
  dueAt: string | null
  deliverable: string
  started: boolean
  progress: number // 0..1 across the 8 steps
  updatedAt: string | null
}

export type ProjectsOverview = {
  assignments: ProjectListItem[]
  capstone: ProjectListItem | null
  personal: ProjectListItem[]
}

export type CoachAction = 'brainstorm' | 'evidence' | 'stakeholders' | 'proofread' | 'review'
export type CoachResult = { action: CoachAction; title: string; markdown: string; blocked?: boolean }

export type AppSettings = { onboarded: boolean; engineChoice: string | null; metrics: boolean }

/** Either a generated image (dataUrl) or a reason it couldn't be made. */
export type IllustrationImage = {
  id: string
  title: string
  dataUrl?: string
  error?: string
  /** True when generation failed because the image quota/credits are exhausted. */
  quota?: boolean
}
