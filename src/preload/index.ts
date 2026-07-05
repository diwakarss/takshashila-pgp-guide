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
  type HarnessStatus,
  type AiStatus,
  type PullProgress,
  type IllustrationImage,
  type IllustrationSpec,
  type LensRequest,
  type AddSnippetRequest,
  type AppSettings,
  type CoachAction,
  type CoachResult,
  type NoteSource,
  type NotebookPage,
  type NotebookPageSummary,
  type Project,
  type ProjectsOverview,
  type ImportProgress,
  type ImportResult,
  type SyncResult,
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
  syncCorpus: (): Promise<SyncResult> => ipcRenderer.invoke(IPC.corpusSync),
  search: (query: string): Promise<SearchHit[]> => ipcRenderer.invoke(IPC.brainSearch, query),
  courses: (): Promise<CourseSummary[]> => ipcRenderer.invoke(IPC.corpusCourses),
  engineStatus: (): Promise<EngineStatus> => ipcRenderer.invoke(IPC.engineStatus),
  engineList: (): Promise<HarnessStatus[]> => ipcRenderer.invoke(IPC.engineList),
  engineSignIn: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.engineSignIn, id),
  engineInstall: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.engineInstall, id),
  aiStatus: (): Promise<AiStatus> => ipcRenderer.invoke(IPC.aiStatus),
  aiSetApiKey: (provider: 'anthropic' | 'openai', key: string): Promise<{ ok: boolean; error: string | null }> =>
    ipcRenderer.invoke(IPC.aiSetApiKey, { provider, key }),
  aiClearApiKey: (provider: 'anthropic' | 'openai'): Promise<void> => ipcRenderer.invoke(IPC.aiClearApiKey, provider),
  aiOllamaPull: (model: string): Promise<boolean> => ipcRenderer.invoke(IPC.aiOllamaPull, model),
  onOllamaPullProgress: (cb: (p: PullProgress) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: PullProgress): void => cb(p)
    ipcRenderer.on(IPC.aiOllamaPullProgress, handler)
    return () => ipcRenderer.removeListener(IPC.aiOllamaPullProgress, handler)
  },
  tutorStart: (question: string, courseCode?: string): Promise<{ threadId: string; title: string }> =>
    ipcRenderer.invoke(IPC.tutorStart, { question, courseCode }),
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
  updateSnippet: (pageId: string, snippetId: string, text: string): Promise<NotebookPage | null> =>
    ipcRenderer.invoke(IPC.notebookUpdateSnippet, { pageId, snippetId, text }),
  deleteSnippet: (pageId: string, snippetId: string): Promise<NotebookPage | null> =>
    ipcRenderer.invoke(IPC.notebookDeleteSnippet, { pageId, snippetId }),
  notebookDelete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.notebookDelete, id),

  projectsOverview: (): Promise<ProjectsOverview> => ipcRenderer.invoke(IPC.projectsOverview),
  openProject: (id: string): Promise<Project | null> => ipcRenderer.invoke(IPC.projectOpen, id),
  createPersonalProject: (title: string): Promise<Project> => ipcRenderer.invoke(IPC.projectCreatePersonal, title),
  updateProject: (
    id: string,
    patch: { title?: string; draft?: string; step?: number; done?: number[]; stepData?: Project['stepData'] }
  ): Promise<Project | null> => ipcRenderer.invoke(IPC.projectUpdate, { id, patch }),
  projectChat: (id: string, step: number, message?: string): Promise<Project | null> =>
    ipcRenderer.invoke(IPC.projectChat, { id, step, message }),
  projectSaveVersion: (id: string, title?: string, final?: boolean): Promise<Project | null> =>
    ipcRenderer.invoke(IPC.projectSaveVersion, { id, title, final }),
  projectSetFinal: (id: string, draftId: string): Promise<Project | null> =>
    ipcRenderer.invoke(IPC.projectSetFinal, { id, draftId }),
  addProjectEvidence: (
    id: string,
    evidence: { title: string; note: string; sources: NoteSource[]; pageId: string | null }
  ): Promise<Project | null> => ipcRenderer.invoke(IPC.projectAddEvidence, { id, evidence }),
  removeProjectEvidence: (id: string, evidenceId: string): Promise<Project | null> =>
    ipcRenderer.invoke(IPC.projectRemoveEvidence, { id, evidenceId }),
  deleteProject: (id: string): Promise<void> => ipcRenderer.invoke(IPC.projectDelete, id),
  projectCoach: (id: string, action: CoachAction): Promise<CoachResult> =>
    ipcRenderer.invoke(IPC.projectCoach, { id, action }),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsSet, patch),
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
