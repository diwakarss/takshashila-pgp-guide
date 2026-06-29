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
  brainSearch: 'brain:search'
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
  score: number
}
