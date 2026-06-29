import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type AppInfo,
  type BrainStats,
  type CorpusStatus,
  type EngineStatus,
  type ImportProgress,
  type ImportResult,
  type SearchHit,
  type TutorAnswer
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
  engineStatus: (): Promise<EngineStatus> => ipcRenderer.invoke(IPC.engineStatus),
  askTutor: (question: string): Promise<TutorAnswer> => ipcRenderer.invoke(IPC.tutorAsk, question),

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
