import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { IPC, type AppInfo } from '../shared/ipc'
import { studyBrain } from './services/studyBrain'
import { agentCliEngine } from './engine/agentCli'
import { imageEngine } from './illustrate/imageEngine'
import { extractConcepts } from './illustrate/extract'
import type { AskRequest, IllustrationImage, IllustrationSpec, QuizSpec } from '../shared/ipc'

// Builder batch: pre-generate the illustration library for the real courses.
// PGP_DEV_BUILD_LIBRARY=1 (PGP_DEV_CLEAR_LIBRARY=1 to wipe first after a style
// change; PGP_DEV_LIB_MAX=N concepts/course). Reuses resolveIllustration, so it
// dedupes and only draws what's new.
async function buildLibrary(): Promise<void> {
  // Back up the current library (named by concept + a manifest) before any clear,
  // so good images can be reinstated by hand later.
  if (process.env['PGP_DEV_BACKUP']) {
    const concepts = await studyBrain.listConcepts()
    const srcDir = studyBrain.illustrationsDir()
    const backupDir = join(app.getPath('userData'), `illustrations-backup-${Date.now()}`)
    mkdirSync(backupDir, { recursive: true })
    const manifest: { title: string; course: string | null; file: string; original: string }[] = []
    for (const c of concepts) {
      const safe = c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
      const dest = `${c.courseCode ?? 'x'}-${safe}.png`
      try {
        copyFileSync(join(srcDir, c.imageFile), join(backupDir, dest))
        manifest.push({ title: c.title, course: c.courseCode, file: dest, original: c.imageFile })
      } catch {
        /* skip missing files */
      }
    }
    writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    console.log(`[lib] backed up ${manifest.length} images to ${backupDir}`)
  }

  if (process.env['PGP_DEV_CLEAR_LIBRARY']) {
    await studyBrain.clearLibrary()
    console.log('[lib] cleared existing library')
  }
  const max = Number(process.env['PGP_DEV_LIB_MAX'] ?? '12')
  const courses = (await studyBrain.courses()).filter((c) => c.code !== 'GENERAL')
  let total = 0
  let generated = 0
  let failed = 0
  for (const course of courses) {
    const titles = await studyBrain.lessonTitles(course.code)
    console.log(`[lib] ${course.code} ${course.name}: ${titles.length} lessons → extracting concepts…`)
    const concepts = await extractConcepts(course.name, titles, agentCliEngine, max)
    console.log(`[lib] ${course.code}: ${concepts.length} concepts to draw`)
    for (const c of concepts) {
      const before = await studyBrain.conceptCount()
      const res = await studyBrain.resolveIllustration(c, course.code)
      const after = await studyBrain.conceptCount()
      total++
      if (res.dataUrl && after > before) generated++
      else if (!res.dataUrl) failed++
      const tag = res.dataUrl ? (after > before ? 'NEW ' : 'reuse') : 'FAIL'
      console.log(`[lib]  ${tag}  ${c.title}${res.error ? ' — ' + res.error : ''}`)
    }
  }
  console.log(
    `[lib] DONE: ${total} concepts, ${generated} generated, ${failed} failed. est cost ~$${(generated * 0.06).toFixed(2)}`
  )
}

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

  ipcMain.handle(IPC.tutorAsk, (_e, req: AskRequest) => studyBrain.ask(req))
  ipcMain.handle(IPC.threadsList, (_e, tab?: string) => studyBrain.listThreads(tab))
  ipcMain.handle(IPC.threadGet, (_e, id: string) => studyBrain.getThread(id))
  ipcMain.handle(IPC.threadDelete, (_e, id: string) => studyBrain.deleteThread(id))

  ipcMain.handle(IPC.quizGenerate, (_e, spec: QuizSpec) => studyBrain.generateQuiz(spec))
  ipcMain.handle(IPC.quizGrade, (_e, req: { question: { prompt: string; modelAnswer: string }; answer: string }) =>
    studyBrain.gradeQuizAnswer(req.question, req.answer)
  )
  ipcMain.handle(IPC.quizIllustration, (_e, req: { concept: string; courseCode?: string }) =>
    studyBrain.reuseIllustration(req.concept, req.courseCode)
  )

  ipcMain.handle(IPC.illustrationAvailable, () => imageEngine.isAvailable())

  ipcMain.handle(
    IPC.illustrationGenerate,
    (_e, req: { spec: IllustrationSpec; courseCode?: string }): Promise<IllustrationImage> =>
      studyBrain.resolveIllustration(req.spec, req.courseCode)
  )
}

// Surface crashes that would otherwise quit the app silently.
process.on('uncaughtException', (e) => console.error('[pgp] uncaughtException:', e))
process.on('unhandledRejection', (e) => console.error('[pgp] unhandledRejection:', e))

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  if (process.env['PGP_DEV_BUILD_LIBRARY']) {
    void buildLibrary().catch((e) => console.error('[lib] build failed:', e))
  }

  if (process.env['PGP_DEV_QUIZ']) {
    void (async () => {
      const lib = await studyBrain.listConcepts()
      console.log(`[quiz] library concepts (${lib.length}):`, JSON.stringify(lib.map((c) => `${c.courseCode ?? 'x'}:${c.title}`)))
      const count = Number(process.env['PGP_DEV_QUIZ_COUNT'] ?? '8')
      const qs = await studyBrain.generateQuiz({ courseCode: process.env['PGP_DEV_QUIZ_COURSE'], count })
      const spread = qs.reduce<Record<string, number>>((m, q) => ({ ...m, [q.kind]: (m[q.kind] ?? 0) + 1 }), {})
      console.log(`[quiz] generated ${qs.length}, spread:`, JSON.stringify(spread))
      for (const q of qs) console.log(`[quiz]  ${q.kind}  concept="${q.concept}"  ${q.prompt.slice(0, 60)}`)
      const ff = qs.find((x) => x.kind === 'freeform')
      if (ff) {
        const v = await studyBrain.gradeQuizAnswer(
          { prompt: ff.prompt, modelAnswer: ff.modelAnswer },
          'A rough partial answer that touches one relevant point but misses the detail.'
        )
        console.log('[quiz] grade sample:', JSON.stringify(v))
      }
      // Reuse check: how many questions keyed to an existing library image?
      let hits = 0
      for (const q of qs) {
        if (!q.concept) continue
        const img = await studyBrain.reuseIllustration(q.concept, process.env['PGP_DEV_QUIZ_COURSE'])
        if (img.dataUrl) hits++
        console.log(`[quiz] reuse "${q.concept}": ${img.dataUrl ? `HIT → ${img.title}` : img.error}`)
      }
      console.log(`[quiz] ${hits}/${qs.length} questions have a reusable illustration`)
    })().catch((e) => console.error('[quiz] failed:', e))
  }

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
          const { turn } = await studyBrain.ask({ question: process.env['PGP_DEV_AUTOASK'] })
          const ans = turn.answer
          console.log(
            `[pgp] dev reply kind=${ans.kind}:`,
            ans.kind === 'slides'
              ? JSON.stringify(ans.slides.map((s) => ({ h: s.heading, ill: s.illustration?.title ?? null })))
              : ans.text.slice(0, 160)
          )
          console.log('[pgp] dev followups:', JSON.stringify(ans.followups))
          console.log('[pgp] dev sources:', ans.sources.map((s) => s.title ?? s.slug).join(' | '))
          if (process.env['PGP_DEV_ILLUS'] && imageEngine.isAvailable() && ans.kind === 'slides') {
            for (const slide of ans.slides) {
              if (!slide.illustration) continue
              const res = await studyBrain.resolveIllustration(slide.illustration)
              console.log(
                res.dataUrl
                  ? `[pgp] dev illustration OK "${slide.illustration.title}" (${res.dataUrl.length} chars)`
                  : `[pgp] dev illustration FAILED "${slide.illustration.title}": ${res.error}`
              )
            }
            console.log('[pgp] dev concept library size:', await studyBrain.conceptCount())
          }
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
