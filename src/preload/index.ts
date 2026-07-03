import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type AppInfo,
  type AskRequest,
  type AskResult,
  type BrainStats,
  type CorpusStatus,
  type CourseSummary,
  type EngineStatus,
  type IllustrationImage,
  type IllustrationSpec,
  type LensRequest,
  type AddSnippetRequest,
  type NotebookPage,
  type NotebookPageSummary,
  type ImportProgress,
  type ImportResult,
  type QuizQuestion,
  type QuizResult,
  type QuizSpec,
  type QuizStats,
  type QuizVerdict,
  type ResearchRequest,
  type WeakSpot,
  type SearchHit,
  type Thread,
  type ThreadDetail
} from '../shared/ipc'

// The ONLY surface the renderer can see. contextIsolation keeps this behind a
// frozen bridge — the renderer never touches ipcRenderer or Node directly.
// Every capability the UI needs is an explicit, typed method added here.
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.ping),
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),

  corpusStatus: (): Promise<CorpusStatus> => ipcRenderer.invoke(IPC.corpusStatus),
  brainStats: (): Promise<BrainStats> => ipcRenderer.invoke(IPC.brainStats),
  importCorpus: (): Promise<ImportResult> => ipcRenderer.invoke(IPC.corpusImport),
  search: (query: string): Promise<SearchHit[]> => ipcRenderer.invoke(IPC.brainSearch, query),
  courses: (): Promise<CourseSummary[]> => ipcRenderer.invoke(IPC.corpusCourses),
  engineStatus: (): Promise<EngineStatus> => ipcRenderer.invoke(IPC.engineStatus),
  askTutor: (req: AskRequest): Promise<AskResult> => ipcRenderer.invoke(IPC.tutorAsk, req),
  researchStart: (question: string): Promise<{ threadId: string; title: string }> =>
    ipcRenderer.invoke(IPC.researchStart, question),
  askResearch: (req: ResearchRequest): Promise<AskResult> => ipcRenderer.invoke(IPC.researchAsk, req),
  researchLens: (req: LensRequest): Promise<AskResult> => ipcRenderer.invoke(IPC.researchLens, req),
  notebookList: (query?: string): Promise<NotebookPageSummary[]> => ipcRenderer.invoke(IPC.notebookList, query),
  notebookGet: (id: string): Promise<NotebookPage | null> => ipcRenderer.invoke(IPC.notebookGet, id),
  notebookCreate: (title?: string): Promise<NotebookPage> => ipcRenderer.invoke(IPC.notebookCreate, title),
  notebookUpdate: (id: string, title: string, body: string): Promise<NotebookPage | null> =>
    ipcRenderer.invoke(IPC.notebookUpdate, { id, title, body }),
  addSnippet: (req: AddSnippetRequest): Promise<NotebookPage | null> => ipcRenderer.invoke(IPC.notebookAddSnippet, req),
  notebookDelete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.notebookDelete, id),
  listThreads: (tab = 'tutor'): Promise<Thread[]> => ipcRenderer.invoke(IPC.threadsList, tab),
  getThread: (id: string): Promise<ThreadDetail | null> => ipcRenderer.invoke(IPC.threadGet, id),
  deleteThread: (id: string): Promise<void> => ipcRenderer.invoke(IPC.threadDelete, id),
  generateQuiz: (spec: QuizSpec): Promise<QuizQuestion[]> => ipcRenderer.invoke(IPC.quizGenerate, spec),
  gradeQuiz: (question: { prompt: string; modelAnswer: string }, answer: string): Promise<QuizVerdict> =>
    ipcRenderer.invoke(IPC.quizGrade, { question, answer }),
  quizIllustration: (concept: string, courseCode?: string): Promise<IllustrationImage> =>
    ipcRenderer.invoke(IPC.quizIllustration, { concept, courseCode }),
  recordQuiz: (result: QuizResult): Promise<QuizStats> => ipcRenderer.invoke(IPC.quizRecord, result),
  quizStats: (): Promise<QuizStats> => ipcRenderer.invoke(IPC.quizStats),
  quizWeakSpots: (courseCode?: string): Promise<WeakSpot[]> => ipcRenderer.invoke(IPC.quizWeakSpots, courseCode),
  illustrationAvailable: (): Promise<boolean> => ipcRenderer.invoke(IPC.illustrationAvailable),
  generateIllustration: (spec: IllustrationSpec, courseCode?: string): Promise<IllustrationImage> =>
    ipcRenderer.invoke(IPC.illustrationGenerate, { spec, courseCode }),

  /** Subscribe to import progress. Returns an unsubscribe fn. */
  onImportProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: ImportProgress): void => cb(p)
    ipcRenderer.on(IPC.corpusImportProgress, handler)
    return () => ipcRenderer.removeListener(IPC.corpusImportProgress, handler)
  }
}

export type PgpApi = typeof api

// contextIsolation is always on (set in the main process webPreferences), so
// the bridge is the only path. If it's ever off, exposing fails loudly rather
// than silently leaking the API onto a non-isolated window — that's correct.
contextBridge.exposeInMainWorld('pgp', api)
