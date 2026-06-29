import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { IPC, type AppInfo } from '../shared/ipc'
import { studyBrain } from './services/studyBrain'

// ┌─────────────────────────────────────────────────────────────────────┐
// │ Main process. Owns the native window + privileged work (brain, fs,   │
// │ engine adapters). The renderer is sandboxed and talks to us only     │
// │ through the typed IPC contract in src/shared/ipc.ts via the preload  │
// │ bridge. No nodeIntegration in the renderer — security baseline.      │
// └─────────────────────────────────────────────────────────────────────┘

const isDev = !app.isPackaged

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'PGP Guide',
    backgroundColor: '#FAF8F3', // parchment, matches DESIGN.md §3.1
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    console.log('[pgp] window ready')
  })

  // Open target=_blank / external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite exposes the renderer dev server URL in dev; the built
  // HTML otherwise. This keeps HMR in dev and a file load in production.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.ping, () => 'pong')

  ipcMain.handle(IPC.appInfo, (): AppInfo => {
    return {
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`
    }
  })

  ipcMain.handle(IPC.corpusStatus, () => studyBrain.corpusStatus())
  ipcMain.handle(IPC.brainStats, () => studyBrain.stats())
  ipcMain.handle(IPC.brainSearch, (_e, query: string) => studyBrain.search(query))

  // Import streams per-file progress back to the renderer that asked, then
  // resolves with the final totals.
  ipcMain.handle(IPC.corpusImport, async (event) => {
    return studyBrain.importCorpus((p) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.corpusImportProgress, p)
    })
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS apps usually stay alive until Cmd+Q; everywhere else, quit.
  if (process.platform !== 'darwin') app.quit()
})
