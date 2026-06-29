import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { IPC, type AppInfo } from '../shared/ipc'
import { studyBrain } from './services/studyBrain'
import { runTutor } from './services/tutor'
import { agentCliEngine } from './engine/agentCli'

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

  ipcMain.handle(IPC.engineStatus, async () => {
    const caps = agentCliEngine.capabilities
    return {
      id: caps.id,
      label: caps.label,
      qualityTier: caps.qualityTier,
      available: await agentCliEngine.isAvailable()
    }
  })

  ipcMain.handle(IPC.corpusCourses, () => studyBrain.courses())

  ipcMain.handle(IPC.tutorAsk, (_e, req: { question: string; courseCode?: string }) =>
    runTutor(req, {
      search: (q, limit, courseCode) => studyBrain.search(q, limit, courseCode),
      engine: agentCliEngine
    })
  )
}

// Surface crashes that would otherwise quit the app silently.
process.on('uncaughtException', (e) => console.error('[pgp] uncaughtException:', e))
process.on('unhandledRejection', (e) => console.error('[pgp] unhandledRejection:', e))

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  // Dev diagnostic: PGP_DEV_AUTOIMPORT=<n> runs a small import on startup and
  // logs the outcome, so an import crash is reproducible headlessly.
  const autoimport = Number(process.env['PGP_DEV_AUTOIMPORT'] ?? '0')
  if (autoimport > 0) {
    void (async () => {
      try {
        console.log(`[pgp] dev auto-import of ${autoimport} files…`)
        const r = await studyBrain.importCorpus(
          (p) => console.log(`[pgp] imported ${p.index}/${p.total} ${p.file} (${p.chunks} chunks)`),
          autoimport
        )
        console.log('[pgp] dev auto-import OK:', JSON.stringify(r))
        console.log('[pgp] dev courses:', JSON.stringify(await studyBrain.courses()))
        if (process.env['PGP_DEV_AUTOASK']) {
          const ans = await runTutor(
            { question: process.env['PGP_DEV_AUTOASK'] },
            {
              search: (q, limit, courseCode) => studyBrain.search(q, limit, courseCode),
              engine: agentCliEngine
            }
          )
          console.log('[pgp] dev auto-ask answer:', ans.answer.slice(0, 400))
          console.log('[pgp] dev auto-ask sources:', ans.sources.map((s) => s.title ?? s.slug).join(' | '))
        }
      } catch (e) {
        console.error('[pgp] dev auto-import FAILED:', e)
      }
    })()
  }

  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS apps usually stay alive until Cmd+Q; everywhere else, quit.
  if (process.platform !== 'darwin') app.quit()
})
