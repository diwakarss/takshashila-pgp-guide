import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppInfo } from '../shared/ipc'

// The ONLY surface the renderer can see. contextIsolation keeps this behind a
// frozen bridge — the renderer never touches ipcRenderer or Node directly.
// Every capability the UI needs is an explicit, typed method added here.
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.ping),
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo)
}

export type PgpApi = typeof api

// contextIsolation is always on (set in the main process webPreferences), so
// the bridge is the only path. If it's ever off, exposing fails loudly rather
// than silently leaking the API onto a non-isolated window — that's correct.
contextBridge.exposeInMainWorld('pgp', api)
