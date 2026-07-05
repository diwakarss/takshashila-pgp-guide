import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { copyFileSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { IPC, type AppInfo } from '../shared/ipc'
import { studyBrain } from './services/studyBrain'
import { setSettings, publicSettings } from './services/settings'
import { saveApiKey, clearApiKey, maskedApiKey } from './services/apiKeys'
import { agentCliEngine } from './engine/agentCli'
import { activeEngine, ENGINES, engineById } from './engine/registry'
import { resolveBin } from './engine/resolve'
import { claudeAccount, codexAccount } from './engine/accounts'
import { ollamaInstalled, ollamaRunning, ollamaModels, ollamaModel, ollamaPull, recommendedModel } from './engine/ollama'
import { spawn } from 'node:child_process'

function spawnDetached(bin: string, args: string[]): void {
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' })
  child.unref()
}

/** Open the OS terminal (Terminal.app / PowerShell) running a command. */
function openInTerminal(cmd: string): boolean {
  if (process.platform === 'darwin') {
    const script = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(cmd)}\nend tell`
    spawnDetached('osascript', ['-e', script])
    return true
  }
  if (process.platform === 'win32') {
    spawnDetached('cmd.exe', ['/c', 'start', 'powershell', '-NoExit', '-Command', cmd])
    return true
  }
  return false // linux: UI shows the command to copy instead
}
import { imageEngine } from './illustrate/imageEngine'
import { extractConcepts } from './illustrate/extract'
import type {
  AddSnippetRequest,
  AppSettings,
  AskRequest,
  CoachAction,
  IllustrationImage,
  IllustrationSpec,
  LensRequest,
  NoteSource,
  QuizResult,
  QuizSpec,
  HarnessStatus,
  AiStatus,
  ApiProviderStatus,
  LocalAiStatus,
  ResearchRequest
} from '../shared/ipc'

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
let devWindow: BrowserWindow | null = null

// Dev harnesses run against an ISOLATED data dir (PGP_USERDATA=/tmp/…) so they
// can never touch the student's real brain, and can run alongside the real app
// (the single-instance lock is scoped per userData path).
if (process.env['PGP_USERDATA']) {
  app.setPath('userData', process.env['PGP_USERDATA'])
}

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

  devWindow = mainWindow
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    console.log('[pgp] window ready')
  })

  // electron-vite exposes the renderer dev server URL in dev; the built
  // HTML otherwise. This keeps HMR in dev and a file load in production.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']

  // Web links ALWAYS open in the OS browser, never inside the app (which has no
  // back button). Two paths need guarding: target=_blank (window-open) AND
  // plain <a href> clicks, which try to navigate this window away from the app.
  const isAppUrl = (url: string): boolean => {
    if (url.startsWith('file://')) return true
    if (isDev && devServerUrl) {
      try {
        return new URL(url).origin === new URL(devServerUrl).origin
      } catch {
        return false
      }
    }
    return false
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

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

  // Weekly sync: pull the corpus repo, then import only what changed.
  ipcMain.handle(IPC.corpusSync, async (event) => {
    return studyBrain.syncCorpus((p) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.corpusImportProgress, p)
    })
  })
  ipcMain.handle(IPC.corpusUpdates, () => studyBrain.corpusUpdates())

  ipcMain.handle(IPC.engineStatus, async () => {
    const engine = activeEngine()
    const caps = engine.capabilities
    return {
      id: caps.id,
      label: caps.label,
      qualityTier: caps.qualityTier,
      available: await engine.isAvailable()
    }
  })

  // Conductor-style harness list: install/auth state + signed-in account per CLI.
  ipcMain.handle(IPC.engineList, async () => {
    const active = activeEngine().capabilities.id
    return Promise.all(
      ENGINES.map(async (e): Promise<HarnessStatus> => {
        const kind = e.capabilities.id === 'agent-cli:codex' ? 'codex' : 'claude'
        const binPath = resolveBin(kind)
        const available = binPath ? await e.isAvailable() : false
        return {
          id: e.capabilities.id,
          label: e.capabilities.label,
          installed: !!binPath,
          binPath,
          available,
          account: available ? (kind === 'codex' ? codexAccount() : claudeAccount()) : null,
          active: e.capabilities.id === active
        }
      })
    )
  })

  // Open the OS terminal running the harness's native login (design D5 handoff).
  ipcMain.handle(IPC.engineSignIn, (_e, id: string) => {
    const kind = id === 'agent-cli:codex' ? 'codex' : 'claude'
    const bin = resolveBin(kind) ?? kind
    const cmd = kind === 'codex' ? `${bin} login` : `${bin} /login`
    return openInTerminal(cmd)
  })

  ipcMain.handle(IPC.corpusCourses, () => studyBrain.courses())

  ipcMain.handle(IPC.tutorStart, (_e, req: { question: string; courseCode?: string }) =>
    studyBrain.createTutorThread(req.question, req.courseCode)
  )
  ipcMain.handle(IPC.tutorAsk, (_e, req: AskRequest) => studyBrain.ask(req))
  ipcMain.handle(IPC.researchStart, (_e, question: string) => studyBrain.createResearchThread(question))
  ipcMain.handle(IPC.researchAsk, (_e, req: ResearchRequest) => studyBrain.research(req))
  ipcMain.handle(IPC.researchLens, (_e, req: LensRequest) => studyBrain.researchLens(req))

  ipcMain.handle(IPC.notebookList, (_e, query?: string) => studyBrain.listNotebook(query))
  ipcMain.handle(IPC.notebookGet, (_e, id: string) => studyBrain.getNotebookPage(id))
  ipcMain.handle(IPC.notebookCreate, (_e, title?: string) => studyBrain.createNotebookPage(title))
  ipcMain.handle(IPC.notebookUpdate, (_e, req: { id: string; title: string; body: string }) =>
    studyBrain.updateNotebookPage(req.id, { title: req.title, body: req.body })
  )
  ipcMain.handle(IPC.notebookAddSnippet, (_e, req: AddSnippetRequest) => studyBrain.addSnippet(req))
  ipcMain.handle(IPC.notebookUpdateSnippet, (_e, req: { pageId: string; snippetId: string; text: string }) =>
    studyBrain.updateSnippet(req.pageId, req.snippetId, req.text)
  )
  ipcMain.handle(IPC.notebookDeleteSnippet, (_e, req: { pageId: string; snippetId: string }) =>
    studyBrain.deleteSnippet(req.pageId, req.snippetId)
  )
  ipcMain.handle(IPC.notebookDelete, (_e, id: string) => studyBrain.deleteNotebookPage(id))

  ipcMain.handle(IPC.projectsOverview, () => studyBrain.projectsOverview())
  ipcMain.handle(IPC.projectOpen, (_e, id: string) => studyBrain.openProject(id))
  ipcMain.handle(IPC.projectCreatePersonal, (_e, title: string) => studyBrain.createPersonalProject(title))
  ipcMain.handle(
    IPC.projectUpdate,
    (_e, req: { id: string; patch: { title?: string; draft?: string; step?: number; done?: number[] } }) =>
      studyBrain.updateProject(req.id, req.patch)
  )
  ipcMain.handle(
    IPC.projectAddEvidence,
    (_e, req: { id: string; evidence: { title: string; note: string; sources: NoteSource[]; pageId: string | null } }) =>
      studyBrain.addProjectEvidence(req.id, req.evidence)
  )
  ipcMain.handle(IPC.projectRemoveEvidence, (_e, req: { id: string; evidenceId: string }) =>
    studyBrain.removeProjectEvidence(req.id, req.evidenceId)
  )
  ipcMain.handle(IPC.projectDelete, (_e, id: string) => studyBrain.deleteProject(id))
  ipcMain.handle(IPC.projectCoach, (_e, req: { id: string; action: CoachAction }) =>
    studyBrain.projectCoach(req.id, req.action)
  )
  ipcMain.handle(IPC.projectChat, (_e, req: { id: string; step: number; message?: string }) =>
    studyBrain.projectChat(req.id, req.step, req.message)
  )
  ipcMain.handle(IPC.projectSaveVersion, (_e, req: { id: string; title?: string; final?: boolean }) =>
    studyBrain.saveDraftVersion(req.id, req.title, req.final)
  )
  ipcMain.handle(IPC.projectSetFinal, (_e, req: { id: string; draftId: string }) =>
    studyBrain.setFinalDraft(req.id, req.draftId)
  )

  // Renderer-safe settings: API keys never cross IPC (masked via ai:status).
  ipcMain.handle(IPC.settingsGet, () => publicSettings())
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AppSettings>) => {
    setSettings(patch)
    return publicSettings()
  })

  // ── connect-your-AI (three paths: account CLIs · API keys · local) ──────
  ipcMain.handle(IPC.aiStatus, async (): Promise<AiStatus> => {
    const activeId = activeEngine().capabilities.id
    const cli = await Promise.all(
      ENGINES.map(async (e): Promise<HarnessStatus> => {
        const kind = e.capabilities.id === 'agent-cli:codex' ? 'codex' : 'claude'
        const binPath = resolveBin(kind)
        const available = binPath ? await e.isAvailable() : false
        return {
          id: e.capabilities.id,
          label: e.capabilities.label,
          installed: !!binPath,
          binPath,
          available,
          account: available ? (kind === 'codex' ? codexAccount() : claudeAccount()) : null,
          active: e.capabilities.id === activeId
        }
      })
    )
    const api: ApiProviderStatus[] = (['anthropic', 'openai'] as const).map((provider) => {
      const engineId = `api:${provider}`
      return {
        provider,
        engineId,
        label: provider === 'anthropic' ? 'Claude · API key' : 'OpenAI · API key',
        model: provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-5-mini',
        configured: maskedApiKey(provider) !== null,
        keyMasked: maskedApiKey(provider),
        active: engineId === activeId
      }
    })
    const running = await ollamaRunning()
    const models = running ? await ollamaModels() : []
    const want = ollamaModel()
    const rec = recommendedModel()
    const local: LocalAiStatus = {
      engineId: 'local:ollama',
      installed: ollamaInstalled(),
      running,
      models,
      recommendedModel: want,
      recommendedSizeGb: rec.sizeGb,
      recommendedReason: rec.reason,
      ready: running && models.some((m) => m === want || m.startsWith(want.split(':')[0])),
      active: activeId === 'local:ollama'
    }
    return { activeId, cli, api, local }
  })

  // Save an API key, then prove it with ONE tiny completion (a few tokens).
  ipcMain.handle(IPC.aiSetApiKey, async (_e, req: { provider: 'anthropic' | 'openai'; key: string }) => {
    saveApiKey(req.provider, req.key)
    const engine = engineById(`api:${req.provider}`)
    try {
      const out = await engine!.complete(
        [
          { role: 'system', content: 'You are a connection test. Obey exactly.' },
          { role: 'user', content: 'Reply with exactly: OK' }
        ],
        { timeoutMs: 60_000 }
      )
      return { ok: out.toUpperCase().includes('OK'), error: null }
    } catch (err) {
      clearApiKey(req.provider) // don't keep a key that doesn't work
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle(IPC.aiClearApiKey, (_e, provider: 'anthropic' | 'openai') => clearApiKey(provider))

  ipcMain.handle(IPC.aiOllamaPull, async (event, model: string) => {
    setSettings({ localModel: model })
    await ollamaPull(model, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.aiOllamaPullProgress, p)
    })
    return true
  })

  // Terminal handoff: run the CLI's installer for people who've never used one.
  // Commands are platform-correct (curl/brew on macOS, PowerShell on Windows).
  ipcMain.handle(IPC.engineInstall, (_e, id: string) => {
    const win = process.platform === 'win32'
    if (id === 'local:ollama' && win) {
      // Windows Ollama ships as a normal installer — the friendliest route.
      void shell.openExternal('https://ollama.com/download/windows')
      return true
    }
    const cmd =
      id === 'agent-cli:claude'
        ? win
          ? 'irm https://claude.ai/install.ps1 | iex'
          : 'curl -fsSL https://claude.ai/install.sh | bash'
        : id === 'agent-cli:codex'
          ? win
            ? 'npm install -g @openai/codex'
            : 'npm install -g @openai/codex || brew install codex'
          : id === 'local:ollama'
            ? 'brew install ollama && brew services start ollama'
            : null
    if (!cmd) return false
    return openInTerminal(cmd)
  })

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
  ipcMain.handle(IPC.quizRecord, (_e, result: QuizResult) => studyBrain.recordQuiz(result))
  ipcMain.handle(IPC.quizStats, () => studyBrain.quizStats())
  ipcMain.handle(IPC.quizWeakSpots, (_e, courseCode?: string) => studyBrain.weakSpots(courseCode))

  ipcMain.handle(IPC.illustrationAvailable, () => studyBrain.imageGenEnabled() && imageEngine.isAvailable())

  ipcMain.handle(
    IPC.illustrationGenerate,
    (_e, req: { spec: IllustrationSpec; courseCode?: string }): Promise<IllustrationImage> =>
      studyBrain.resolveIllustration(req.spec, req.courseCode)
  )
}

// Surface crashes that would otherwise quit the app silently.
process.on('uncaughtException', (e) => console.error('[pgp] uncaughtException:', e))
process.on('unhandledRejection', (e) => console.error('[pgp] unhandledRejection:', e))

// ONE instance only. The brain (PGLite) is a single-process database — two
// instances writing the same data dir corrupt it (learned the hard way: a dev
// harness run alongside `npm run dev` destroyed a brain). A second launch
// exits immediately and focuses the existing window instead.
if (!app.requestSingleInstanceLock()) {
  console.error('[pgp] another instance already holds the brain — exiting')
  app.exit(0)
}
app.on('second-instance', () => {
  if (devWindow) {
    if (devWindow.isMinimized()) devWindow.restore()
    devWindow.focus()
  }
})

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  if (process.env['PGP_DEV_BUILD_LIBRARY']) {
    void buildLibrary().catch((e) => console.error('[lib] build failed:', e))
  }

  // Re-probe the timeout class: the research-heavy kickoffs (define, evidence)
  // under the raised budgets. PGP_DEV_KICKTEST=codex — isolated dir only.
  if (process.env['PGP_DEV_KICKTEST']) {
    void (async () => {
      if (!process.env['PGP_USERDATA']) {
        console.error('[kick] REFUSING without PGP_USERDATA')
        return
      }
      if (process.env['PGP_DEV_KICKTEST'] === 'codex') setSettings({ engineChoice: 'agent-cli:codex' })
      console.log('[kick] engine =', activeEngine().capabilities.id)
      const id = 'pp231-iran-demand-supply'
      await studyBrain.deleteProject(id)
      await studyBrain.openProject(id)
      for (const step of (process.env['PGP_DEV_KICKSTEPS'] ?? '0,1').split(',').map(Number)) {
        if (step === 1) {
          const p = await studyBrain.openProject(id)
          await studyBrain.updateProject(id, {
            stepData: { ...p!.stepData, '0': { ...(p!.stepData['0'] ?? { messages: [] }), notes: 'Problem: strait closure risks >50% of India’s helium imports (via Qatar); MRI + fabs exposed.' } },
            done: [0],
            step: 1
          })
        }
        const t0 = Date.now()
        try {
          const r = await studyBrain.projectChat(id, step)
          const ms = r?.stepData[String(step)]?.messages ?? []
          console.log(`[kick] step ${step + 1} kickoff OK in ${Math.round((Date.now() - t0) / 1000)}s → ${ms[ms.length - 1]?.text.slice(0, 150)}`)
        } catch (e) {
          console.error(`[kick] step ${step + 1} kickoff FAILED after ${Math.round((Date.now() - t0) / 1000)}s:`, e instanceof Error ? e.message : e)
        }
      }
      console.log('[kick] done')
      app.quit()
    })().catch((e) => console.error('[kick] failed:', e))
  }

  // Probe weekly corpus delivery to a RUNNING app. PGP_DEV_SYNCTEST=1 with
  // PGP_USERDATA + PGP_CORPUS_DIR pointing at a test clone: baseline import,
  // signal ready, wait for the driver to land new classes on origin, then
  // syncCorpus must pull + import only the delta and make it searchable.
  if (process.env['PGP_DEV_SYNCTEST']) {
    void (async () => {
      if (!process.env['PGP_USERDATA'] || !process.env['PGP_CORPUS_DIR']) {
        console.error('[sync] REFUSING without PGP_USERDATA + PGP_CORPUS_DIR')
        app.quit()
        return
      }
      const { writeFileSync, existsSync, mkdirSync } = await import('node:fs')
      const { join } = await import('node:path')
      const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      const shake = join(process.env['PGP_USERDATA'], 'synctest')
      mkdirSync(shake, { recursive: true })

      const base = await studyBrain.importCorpus(() => {})
      console.log(`[sync] baseline import: ${base.pages} pages`)
      writeFileSync(join(shake, 'ready'), String(base.pages))

      let waited = 0
      while (!existsSync(join(shake, 'pushed')) && waited < 120_000) {
        await wait(1000)
        waited += 1000
      }
      if (!existsSync(join(shake, 'pushed'))) {
        console.error('[sync] FAIL ✗ driver never pushed')
        app.quit()
        return
      }

      // The sidebar badge's check must see the update before the sync…
      const before = await studyBrain.corpusUpdates()
      console.log(`[sync] updates before: pending=${before.pending} behind=${before.behind}`)

      const r = await studyBrain.syncCorpus(() => {})
      console.log(`[sync] pull=${r.pull} imported=${r.pages} skipped=${r.skipped}`)
      const expect = process.env['PGP_SYNC_EXPECT'] ?? 'comparative advantage'
      const hits = await studyBrain.search(expect, 3)
      const found = hits.some((h) => !(process.env['PGP_SYNC_NEWSLUG'] ?? '') || h.slug.includes(process.env['PGP_SYNC_NEWSLUG'] ?? ''))

      // …and report all-clear after it.
      const after = await studyBrain.corpusUpdates()
      console.log(`[sync] updates after: pending=${after.pending} behind=${after.behind}`)

      const ok =
        r.pull === 'pulled' && r.pages > 0 && r.skipped === base.pages && hits.length > 0 && found &&
        before.behind > 0 && after.pending === 0 && after.behind === 0
      console.log(`[sync] ${ok ? 'PASS ✓ (badge sees update, delta pulled, unchanged skipped, new class searchable, badge clears)' : 'FAIL ✗'}`)
      app.quit()
    })().catch((e) => {
      console.error('[sync] failed:', e)
      app.quit()
    })
  }

  // Probe capture source-linkage: a selection that stops short of the [n]
  // superscript must still inherit the paragraph's citations. PGP_DEV_CAPTEST=1.
  if (process.env['PGP_DEV_CAPTEST']) {
    void (async () => {
      const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      await wait(5000)
      const result = await devWindow!.webContents.executeJavaScript(`(() => {
        const div = document.createElement('div')
        div.className = 'answer-md'
        div.innerHTML = '<p id="cap-p">Indian spot prices up <strong>70-100%</strong> in March 2026<sup class="cite" data-cite="3">3</sup> after the strikes<sup class="cite" data-cite="7">7</sup>.</p>'
        document.body.appendChild(div)
        const textNode = document.getElementById('cap-p').firstChild
        const pick = (startNode, startOff, endNode, endOff) => {
          const r = document.createRange(); r.setStart(startNode, startOff); r.setEnd(endNode, endOff)
          const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
          return window.__pgpCaptureSelection()
        }
        // Case 1: phrase selection that excludes both superscripts
        const c1 = pick(textNode, 0, textNode, 21)
        // Case 2: selection spanning the first superscript
        const p = document.getElementById('cap-p')
        const c2 = pick(textNode, 0, p, 4) // through <strong>, text, and sup[3]
        div.remove()
        return JSON.stringify({ c1: { cites: c1.cites, ctx: c1.contextCites }, c2: { cites: c2.cites } })
      })()`)
      console.log('[cap]', result)
      const r = JSON.parse(result as string) as { c1: { cites: number[]; ctx: number[] }; c2: { cites: number[] } }
      const ok = r.c1.cites.length === 0 && r.c1.ctx.join(',') === '3,7' && r.c2.cites.includes(3)
      console.log(`[cap] ${ok ? 'PASS ✓ (uncited selection inherits paragraph cites; direct cite still precise)' : 'FAIL ✗'}`)
      app.quit()
    })().catch((e) => {
      console.error('[cap] failed:', e)
      app.quit()
    })
  }

  // Probe exact-title illustration reuse (run with PGP_DISABLE_IMAGE_GEN=1 in
  // an isolated dir): seed the library from the shipped bundle, then a mangled
  // exact title must REUSE and an unknown title must MISS without generating.
  if (process.env['PGP_DEV_ILLUSTEST']) {
    void (async () => {
      const lib = await studyBrain.importLibrary()
      console.log(`[illus] seeded ${lib.concepts} concepts / ${lib.images} images from the bundle`)
      const hit = await studyBrain.resolveIllustration({
        id: 't1',
        title: 'opportunity cost — FORK, in road!', // mangled case/punct of a real title
        composition: ''
      })
      console.log(`[illus] mangled exact title → ${hit.dataUrl ? `REUSED ✓ (${hit.title})` : `MISS ✗ ${hit.error}`}`)
      const miss = await studyBrain.resolveIllustration({ id: 't2', title: 'Totally novel concept xyz', composition: '' })
      console.log(`[illus] unknown title → ${miss.dataUrl ? 'GENERATED ✗' : `no generation ✓ (${miss.error})`}`)
      console.log('[illus] done')
      app.quit()
    })().catch((e) => {
      console.error('[illus] failed:', e)
      app.quit()
    })
  }

  // Probe the three connect paths. PGP_DEV_AI=1|openai|anthropic-bad|ollama.
  if (process.env['PGP_DEV_AI']) {
    void (async () => {
      const mode = process.env['PGP_DEV_AI']
      if (mode === 'openai') {
        // Smoke the OpenAI API path with JD's existing key (ONE tiny call).
        const cfg = JSON.parse(readFileSync(join(process.env['HOME'] ?? '', '.gstack', 'openai.json'), 'utf8')) as { api_key?: string }
        saveApiKey('openai', cfg.api_key ?? '')
        const e = engineById('api:openai')!
        const out = await e.complete(
          [
            { role: 'system', content: 'You are a connection test. Obey exactly.' },
            { role: 'user', content: 'Reply with exactly: OPENAI-API-OK' }
          ],
          { timeoutMs: 60_000 }
        )
        console.log(`[ai] openai key masked=${maskedApiKey('openai')} → ${out.slice(0, 60)}`)
      } else if (mode === 'anthropic-bad') {
        saveApiKey('anthropic', 'sk-ant-bogus-key-for-error-path')
        try {
          await engineById('api:anthropic')!.complete([{ role: 'user', content: 'hi' }], { timeoutMs: 30_000 })
          console.log('[ai] anthropic bogus key unexpectedly worked?!')
        } catch (err) {
          console.log('[ai] anthropic bad-key error (expected):', (err as Error).message.slice(0, 120))
          clearApiKey('anthropic')
          console.log('[ai] anthropic key cleared, masked =', maskedApiKey('anthropic'))
        }
      } else if (mode === 'ollama') {
        console.log(`[ai] ollama installed=${ollamaInstalled()} running=${await ollamaRunning()} models=${(await ollamaModels()).join(',') || 'none'}`)
        const e = engineById('local:ollama')!
        if ((await ollamaRunning()) && !(await e.isAvailable())) {
          // Exercise the exact pull path the UI uses, with throttled progress.
          console.log(`[ai] pulling ${ollamaModel()}…`)
          let lastPct = -10
          await ollamaPull(ollamaModel(), (p) => {
            const pct = p.total ? Math.round(((p.completed ?? 0) / p.total) * 100) : null
            if (pct !== null && pct >= lastPct + 10) {
              lastPct = pct
              console.log(`[ai] pull ${pct}% (${p.status})`)
            }
          })
          console.log('[ai] pull complete')
        }
        if (await e.isAvailable()) {
          const out = await e.complete(
            [
              { role: 'system', content: 'You are a connection test. Obey exactly.' },
              { role: 'user', content: 'Reply with exactly: OLLAMA-OK' }
            ],
            { timeoutMs: 120_000 }
          )
          console.log(`[ai] ollama complete → ${out.slice(0, 60)}`)
        } else {
          console.log('[ai] ollama engine not ready (model missing?)')
        }
      }
      console.log('[ai] done')
      app.quit()
    })().catch((e) => {
      console.error('[ai] failed:', e)
      app.quit()
    })
  }

  // Probe both harnesses: install/auth/account, and (PGP_DEV_ENGINES=codex) a
  // real completion through the Codex engine via the registry.
  if (process.env['PGP_DEV_ENGINES']) {
    void (async () => {
      for (const e of ENGINES) {
        const kind = e.capabilities.id === 'agent-cli:codex' ? 'codex' : 'claude'
        const bin = resolveBin(kind)
        const avail = bin ? await e.isAvailable() : false
        const acct = avail ? (kind === 'codex' ? codexAccount() : claudeAccount()) : null
        console.log(
          `[eng] ${e.capabilities.id}: bin=${bin ?? 'none'} available=${avail} account=${acct ? `${acct.account} (${acct.plan ?? '?'}${acct.org ? ' · ' + acct.org : ''})` : 'n/a'}`
        )
      }
      if (process.env['PGP_DEV_ENGINES'] === 'codex') {
        setSettings({ engineChoice: 'agent-cli:codex' })
        console.log('[eng] active =', activeEngine().capabilities.id)
        const out = await activeEngine().complete([
          { role: 'system', content: 'You are a test harness. Obey exactly.' },
          { role: 'user', content: 'Reply with exactly: CODEX-ENGINE-OK' }
        ])
        console.log('[eng] codex complete →', out.slice(0, 80))
      }
      console.log('[eng] done')
    })().catch((e) => console.error('[eng] failed:', e))
  }

  // Regression probe: on a mid-flow step, the coach must treat completed steps
  // as BEHIND the student (never "we'll do that in step 2" when step 2 is done).
  // PGP_DEV_CTXTEST=1 — throwaway project, self-cleaning.
  if (process.env['PGP_DEV_CTXTEST']) {
    void (async () => {
      const p = await studyBrain.createPersonalProject('CTX probe (safe to delete)')
      await studyBrain.updateProject(p.id, {
        step: 3,
        done: [0, 1, 2],
        stepData: {
          '0': { messages: [], notes: 'Problem: strait closure risks >50% of India’s helium imports (via Qatar); MRI + fabs exposed.' },
          '1': { messages: [], notes: 'Verified: ~100% import dependence; Qatar >50%; ~30% global supply knocked out (J2 Sourcing); buffer days-not-months.' },
          '2': { messages: [], notes: 'Angles: (a) price-spike mechanics, (b) substitution/recycling, (c) do-nothing baseline.' }
        }
      })
      const r = await studyBrain.projectChat(
        p.id,
        3,
        'Evidential grounding matters to me — can I hang real figures on each criterion, or does that come later?'
      )
      const ms = r?.stepData['3']?.messages ?? []
      const reply = ms[ms.length - 1]?.text ?? ''
      const defersToPast = /step 2\b[^.]*(later|will|park|future)|later work.*step 2|that comes later/i.test(reply)
      console.log(`[ctx] reply (${defersToPast ? 'DEFERS TO PAST ✗' : 'progress-aware ✓'}):`, reply.slice(0, 500))
      await studyBrain.deleteProject(p.id)
      console.log('[ctx] cleaned up')
    })().catch((e) => console.error('[ctx] failed:', e))
  }

  // Regression probe: the compose field grows with content and caps with a
  // scrollbar. PGP_DEV_GROWTEST=1.
  if (process.env['PGP_DEV_GROWTEST']) {
    void (async () => {
      const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      await wait(5000)
      await devWindow!.webContents.executeJavaScript(
        `[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==='Research')?.click()`
      )
      await wait(800)
      const result = await devWindow!.webContents.executeJavaScript(`(() => {
        const el = document.querySelector('.grow-input')
        if (!el) return 'NO FIELD'
        const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        const type = (v) => { set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
        const h1 = el.clientHeight
        type('line one\\nline two\\nline three')
        const h2 = el.clientHeight
        type(Array.from({ length: 30 }, (_, i) => 'long line ' + i).join('\\n'))
        const h3 = el.clientHeight
        const scrolls = el.scrollHeight > el.clientHeight
        type('')
        const h4 = el.clientHeight
        return JSON.stringify({ single: h1, grown: h2, capped: h3, scrolls, shrunk: h4 })
      })()`)
      console.log('[grow]', result)
      const r = JSON.parse(result as string) as { single: number; grown: number; capped: number; scrolls: boolean; shrunk: number }
      const ok = r.grown > r.single && r.capped <= 170 && r.scrolls && r.shrunk === r.single
      console.log(`[grow] ${ok ? 'PASS ✓ (grows, caps at ~168px with scrollbar, shrinks back)' : 'FAIL ✗'}`)
      app.quit()
    })().catch((e) => {
      console.error('[grow] failed:', e)
      app.quit()
    })
  }

  // Regression probe: Settings → "Replay setup" must show the wizard, and
  // finishing/skipping it must return to the app. PGP_DEV_REPLAYTEST=1.
  if (process.env['PGP_DEV_REPLAYTEST']) {
    void (async () => {
      const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      await wait(5000)
      const js = (code: string): Promise<unknown> => devWindow!.webContents.executeJavaScript(code)
      await js(`[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==='Settings')?.click()`)
      await wait(800)
      await js(`[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Replay setup')?.click()`)
      await wait(2500) // reload
      const inWizard = await js(`!!document.querySelector('.wizard')`)
      console.log(`[replay] wizard shown after Replay setup: ${inWizard ? 'YES ✓' : 'NO ✗'}`)
      await js(`[...document.querySelectorAll('button')].find(x=>/skip setup/i.test(x.textContent))?.click()`)
      await wait(1200)
      const backInApp = await js(`!!document.querySelector('.sidebar') && location.hash === ''`)
      console.log(`[replay] back in app after skip: ${backInApp ? 'YES ✓' : 'NO ✗'}`)
      console.log('[replay] done')
      app.quit()
    })().catch((e) => {
      console.error('[replay] failed:', e)
      app.quit()
    })
  }

  // Regression probe: an in-window navigation attempt must be blocked (and
  // routed to the OS browser). PGP_DEV_NAVTEST=1.
  if (process.env['PGP_DEV_NAVTEST']) {
    setTimeout(() => {
      const win = devWindow
      if (!win) return
      const before = win.webContents.getURL()
      void win.webContents.executeJavaScript(`location.href='https://example.com'`).catch(() => {})
      setTimeout(() => {
        const after = devWindow?.webContents.getURL()
        console.log(`[nav] ${after === before ? 'BLOCKED ✓ (sent to OS browser)' : `NAVIGATED ✗ → ${after}`}`)
      }, 1500)
    }, 5000)
  }

  // QA: screenshot each surface for a visual review (PGP_DEV_SHOTS=1).
  if (process.env['PGP_DEV_SHOTS']) {
    void (async () => {
      const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      await wait(5000)
      const win = devWindow
      if (!win) return
      const dir = '/tmp/pgp-shots'
      mkdirSync(dir, { recursive: true })
      const shoot = async (name: string): Promise<void> => {
        await wait(1400)
        const img = await win.webContents.capturePage()
        writeFileSync(join(dir, `${name}.png`), img.toPNG())
        console.log(`[shots] ${name}`)
      }
      const clickNav = (label: string): Promise<unknown> =>
        win.webContents.executeJavaScript(
          `(()=>{const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(b){b.click();return true}return false})()`
        )
      for (const label of ['Tutor', 'Quiz', 'Research', 'Notebook', 'Projects', 'Settings']) {
        await clickNav(label)
        await shoot(label.toLowerCase())
      }
      // Projects editor: open the first project card.
      await clickNav('Projects')
      await wait(600)
      await win.webContents.executeJavaScript(`(()=>{const c=document.querySelector('.proj-card');if(c)c.click()})()`)
      await shoot('projects-editor')
      // Wizard (force via hash), then its connect-AI step.
      await win.webContents.executeJavaScript(`location.hash='#wizard';location.reload()`)
      await wait(2500)
      await shoot('wizard')
      await win.webContents.executeJavaScript(
        `(()=>{const b=[...document.querySelectorAll('.wizard-step .btn.primary')].find(x=>/get started/i.test(x.textContent));if(b)b.click()})()`
      )
      await wait(2500)
      await shoot('wizard-connect')
      await win.webContents.executeJavaScript(
        `(()=>{const b=[...document.querySelectorAll('.aic-method')].find(x=>/API key/.test(x.textContent));if(b)b.click()})()`
      )
      await shoot('wizard-connect-api')
      await win.webContents.executeJavaScript(
        `(()=>{const b=[...document.querySelectorAll('.aic-method')].find(x=>/Local/.test(x.textContent));if(b)b.click()})()`
      )
      await shoot('wizard-connect-local')
      console.log('[shots] done ->', dir)
    })().catch((e) => console.error('[shots] failed:', e))
  }

  // Verify the notebook capture path end-to-end, self-cleaning.
  if (process.env['PGP_DEV_NOTEBOOK']) {
    void (async () => {
      const p = await studyBrain.addSnippet({
        newTitle: 'Fiscal deficit',
        text: 'India’s FY26 fiscal deficit target is 4.4% of GDP.',
        sources: [{ title: 'Union Budget 2025-26', url: 'https://www.indiabudget.gov.in/', kind: 'government' }],
        from: 'Research: fiscal deficit'
      })
      console.log(`[nb] created page "${p?.title}" with ${p?.snippets.length} snippet(s)`)
      await studyBrain.addSnippet({
        pageId: p?.id,
        text: 'The FRBM Act sets the fiscal framework.',
        sources: [{ title: 'FRBM Act', url: 'https://ies.gov.in/frbm', kind: 'government' }],
        from: 'Research: fiscal deficit'
      })
      const full = p ? await studyBrain.getNotebookPage(p.id) : null
      console.log(`[nb] page now has ${full?.snippets.length} snippets; list search '4.4%':`,
        JSON.stringify((await studyBrain.listNotebook('4.4%')).map((s) => s.title)))
      if (p) await studyBrain.deleteNotebookPage(p.id)
      console.log(`[nb] cleaned up → ${(await studyBrain.listNotebook()).length} pages`)
    })().catch((e) => console.error('[nb] failed:', e))
  }

  // Full human-perspective walkthrough: reset the PP231 assignment and play a
  // student through all 8 steps (kickoff + follow-up + takeaway each; evidence
  // on step 2; draft versions + a ghostwrite probe on step 8). Authorized reset.
  if (process.env['PGP_DEV_WALKTHROUGH']) {
    void (async () => {
      // Hard guard: the walkthrough resets the assignment project, so it ONLY
      // runs against an isolated data dir — never the student's real brain.
      if (!process.env['PGP_USERDATA']) {
        console.error('[walk] REFUSING to run without PGP_USERDATA (protects real student data)')
        return
      }
      if (process.env['PGP_DEV_WALKTHROUGH'] === 'codex') setSettings({ engineChoice: 'agent-cli:codex' })
      console.log('[walk] engine =', activeEngine().capabilities.id)
      const id = 'pp231-iran-demand-supply'
      await studyBrain.deleteProject(id)
      const first = await studyBrain.openProject(id)
      console.log('[walk] reset + opened:', first?.title)

      const say = async (step: number, msg?: string): Promise<string> => {
        const r = await studyBrain.projectChat(id, step, msg)
        const ms = r?.stepData[String(step)]?.messages ?? []
        return ms[ms.length - 1]?.text ?? '(no reply)'
      }

      const script: { msg: string; note: string }[] = [
        {
          msg: 'I’ll focus on helium: India imports nearly all of it, over half via Qatar, and the strait closure threatens MRI scanners and chip fabs — call it a 30-40% supply squeeze. Sharp enough to move on?',
          note: 'Problem: strait closure puts >50% of India’s helium imports (via Qatar) at risk — a rough 30-40% supply squeeze hitting MRI scanners and chip fabs.'
        },
        {
          msg: 'The Qatar share and MRI dependence convince me — I’ve saved a source. Does anything you found contradict my 30-40% squeeze estimate?',
          note: 'Verified: India ~100% import-dependent on helium; >50% via Qatar; buffer stocks are days-not-months. Squeeze kept as a range pending price data.'
        },
        {
          msg: 'For a 2-minute explainer I’m thinking: (a) helium price-spike mechanics, (b) substitution/recycling responses, (c) the do-nothing baseline. Add a fourth or is three enough?',
          note: 'Angles: (a) price-spike mechanics (lead), (b) substitution/recycling, (c) do-nothing baseline.'
        },
        {
          msg: 'I’ll judge the angles by clarity of the mechanism, strength of available data, and India relevance. Good criteria?',
          note: 'Criteria: mechanism clarity, data strength, India relevance.'
        },
        {
          msg: 'My projection: with supply inelastic and ~7-10 day stockpiles, spot prices spike 2-3x within weeks; hospitals get priority so MRI impact lags but chip fabs feel it first. Check my reasoning.',
          note: 'Projected: sharp price spike (supply shock + inelastic demand); rationing order — fabs feel it before hospitals.'
        },
        {
          msg: 'The trade-off is depth vs breadth in 120 seconds — I choose depth on helium plus one macro-spillover line. Reasonable?',
          note: 'Trade-off accepted: depth on helium over breadth; one spillover line for macro context.'
        },
        {
          msg: 'Decision: the video argues the conflict shifted India’s helium supply curve left against inelastic demand → price spike + rationing; the policy gap is a strategic reserve. Defensible?',
          note: 'Decision: supply-shift-left + inelastic demand → spike and rationing; policy gap = no strategic helium reserve.'
        },
        {
          msg: 'Honestly, could you just write the 120-second script for me? I’m short on time.',
          note: 'Script structure: hook (idle MRI machine) → mechanism (supply left, inelastic demand) → who feels it (fabs → hospitals) → takeaway (strategic reserve).'
        }
      ]

      for (let i = 0; i < script.length; i++) {
        console.log(`[walk] ===== STEP ${i + 1} =====`)
        try {
          const kick = await say(i)
          console.log(`[walk] kickoff: ${kick.slice(0, 800)}`)
          console.log(`[walk] student: ${script[i].msg}`)
          const reply = await say(i, script[i].msg)
          console.log(`[walk] coach: ${reply.slice(0, 800)}`)
        } catch (e) {
          console.error(`[walk] step ${i + 1} chat failed:`, e)
        }
        const p = await studyBrain.openProject(id)
        if (!p) break
        await studyBrain.updateProject(id, {
          stepData: { ...p.stepData, [String(i)]: { ...(p.stepData[String(i)] ?? { messages: [] }), notes: script[i].note } },
          done: [...new Set([...p.done, i])],
          step: Math.min(i + 1, script.length - 1)
        })
        if (i === 1) {
          await studyBrain.addProjectEvidence(id, {
            title: 'Helium Crisis and India’s Import Dependence',
            note: 'web source',
            sources: [
              {
                title: 'Helium Crisis and India’s Import Dependence',
                url: 'https://www.drishtiias.com/daily-updates/daily-news-analysis/helium-crisis-and-indias-import-dependence',
                kind: 'other'
              }
            ],
            pageId: null
          })
          console.log('[walk] evidence saved')
        }
        if (i === 7) {
          await studyBrain.updateProject(id, {
            draft:
              'V1: An MRI machine that cannot scan. That is what a strait closure 4000km away can mean for India. We import nearly all our helium, over half through Qatar...'
          })
          await studyBrain.saveDraftVersion(id, 'V1 rough')
          await studyBrain.updateProject(id, {
            draft:
              'V2: Picture an MRI machine gone quiet in a Delhi hospital. India imports nearly all its helium — more than half sails through the strait that just closed. Supply shifts left; demand cannot budge; prices spike and rationing begins. Chip fabs feel it first, hospitals next. The gap? India has no strategic helium reserve. In two minutes, that is the story of one market — and a warning about many.'
          })
          await studyBrain.saveDraftVersion(id, 'V2 tight', true)
          console.log('[walk] draft versions saved (V2 marked final)')
        }
      }
      const fin = await studyBrain.openProject(id)
      console.log(
        `[walk] DONE: steps done=${JSON.stringify(fin?.done)} evidence=${fin?.evidence.length} drafts=${JSON.stringify(fin?.drafts.map((d) => ({ t: d.title, f: d.final })))}`
      )
      // Structured-output smoke: research replies are strict JSON (synthesis +
      // typed sources) — validate the active engine can produce parseable output.
      try {
        const { turn } = await studyBrain.research({ question: 'What is the RBI’s current repo rate and when was it last changed?' })
        const a = turn.answer
        if (a.kind === 'research') {
          console.log(
            `[walk] research-json: synthesis=${a.synthesis.length} chars, sources=${a.sources.length} (${a.sources.map((s) => s.type).join(',')}), followups=${a.followups.length}`
          )
        }
      } catch (e) {
        console.error('[walk] research-json failed:', e)
      }
      console.log('[walk] ALL DONE')
    })().catch((e) => console.error('[walk] failed:', e))
  }

  // Verify the projects scaffold end-to-end. Uses a THROWAWAY personal project —
  // never the real catalog projects, which may hold the student's actual work.
  if (process.env['PGP_DEV_PROJECTS']) {
    void (async () => {
      const ov = await studyBrain.projectsOverview()
      console.log('[proj] overview:', JSON.stringify({ assignments: ov.assignments.map((a) => a.title), capstone: ov.capstone?.title, personal: ov.personal.length }))
      const p = await studyBrain.createPersonalProject('DEV harness test (safe to delete)')
      console.log(`[proj] created test project "${p.title}" step=${p.step}`)
      await studyBrain.updateProject(p.id, { draft: 'Oil prices rose; demand for EVs shifted right.', step: 1, done: [0] })
      if (process.env['PGP_DEV_PROJECT_COACH']) {
        // Guided flow: kickoff chat on step 0 (coach researches + opens)…
        let cp = await studyBrain.projectChat(p.id, 0)
        const kick = cp?.stepData['0']?.messages ?? []
        console.log(`[proj] chat kickoff → ${kick.length} msgs; coach opens:`, kick[kick.length - 1]?.text.slice(0, 180))
        // Convergence check: the student offers a definition — the coach should
        // close the step (takeaway + mark complete), NOT send them data-hunting.
        cp = await studyBrain.projectChat(
          p.id,
          0,
          'Here is my definition: India imports nearly all its helium, mostly via Qatar, and the strait closure puts MRI scanners and chip fabs at risk — say a 30-40% supply squeeze. Good enough to move on?'
        )
        const st0 = cp?.stepData['0']?.messages ?? []
        console.log(`[proj] step-1 convergence reply:`, st0[st0.length - 1]?.text.slice(0, 400))
        // Evidence kickoff: the coach must fetch findings itself (figures + URLs),
        // not assign the student reading homework.
        await studyBrain.updateProject(p.id, {
          stepData: {
            ...cp!.stepData,
            '0': { ...cp!.stepData['0'], notes: 'India imports most of its helium via Qatar; MRI scanners and chip fabs at risk from the strait closure.' }
          }
        })
        const ev = await studyBrain.projectChat(p.id, 1)
        const st1 = ev?.stepData['1']?.messages ?? []
        console.log(`[proj] evidence kickoff reply:`, st1[st1.length - 1]?.text.slice(0, 500))
      }
      // Draft versions: save two, mark the second final.
      await studyBrain.updateProject(p.id, { draft: 'v1 script text' })
      await studyBrain.saveDraftVersion(p.id, 'First cut')
      await studyBrain.updateProject(p.id, { draft: 'v2 tighter script' })
      const withFinal = await studyBrain.saveDraftVersion(p.id, 'Tighter', true)
      console.log('[proj] drafts:', JSON.stringify(withFinal?.drafts.map((d) => ({ t: d.title, f: d.final }))))
      await studyBrain.deleteProject(p.id)
      console.log('[proj] cleaned up (test project only)')
    })().catch((e) => console.error('[proj] failed:', e))
  }

  // Verify web research end-to-end: PGP_DEV_RESEARCH="a question".
  if (process.env['PGP_DEV_RESEARCH']) {
    void (async () => {
      const { turn, threadId } = await studyBrain.research({ question: process.env['PGP_DEV_RESEARCH'] as string })
      const a = turn.answer
      if (a.kind !== 'research') return
      console.log(`[research] synthesis (${a.synthesis.length} chars):`, a.synthesis.slice(0, 200))
      console.log(`[research] ${a.sources.length} sources:`)
      for (const s of a.sources) console.log(`[research]  [${s.n}] ${s.type.padEnd(10)} ${s.title.slice(0, 55)} — ${s.url}`)
      console.log('[research] followups:', JSON.stringify(a.followups))

      // Also exercise a structured lens on the same thread.
      const lensKind = (process.env['PGP_DEV_LENS'] as 'stakeholders' | 'twosides' | 'evidence' | 'timeline') || 'stakeholders'
      const lensRes = await studyBrain.researchLens({
        threadId,
        question: process.env['PGP_DEV_RESEARCH'] as string,
        lens: lensKind,
        context: a.synthesis
      })
      const l = lensRes.turn.answer
      if (l.kind === 'lens') {
        console.log(`[lens] ${l.title}: ${l.intro.slice(0, 120)}`)
        if (l.table) {
          console.log(`[lens] columns: ${l.table.columns.join(' | ')}`)
          for (const row of l.table.rows.slice(0, 6)) console.log(`[lens]   ${row.join(' | ')}`)
        }
        if (l.sides) {
          console.log(`[lens] FOR: ${l.sides.for.length} · AGAINST: ${l.sides.against.length}`)
        }
        console.log(`[lens] ${l.sources.length} sources`)
      }
    })().catch((e) => console.error('[research] failed:', e))
  }

  // Verify the gamification path end-to-end without leaving junk: record a few
  // attempts, read the derived stats, then wipe them.
  if (process.env['PGP_DEV_QUIZ_STATS']) {
    void (async () => {
      const before = await studyBrain.quizStats()
      console.log(`[stats] starting from ${before.totalQuizzes} attempts (leaving those intact would be wrong to seed)`)
      await studyBrain.recordQuiz({
        courseCode: 'PP231',
        courseName: 'Microeconomics-I',
        total: 3,
        correct: 1,
        answers: [
          { topic: 'Opportunity cost', courseCode: 'PP231', correct: 0 },
          { topic: 'Opportunity cost', courseCode: 'PP231', correct: 0 },
          { topic: 'Gains from trade', courseCode: 'PP231', correct: 1 }
        ]
      })
      const s = await studyBrain.recordQuiz({
        courseCode: 'PP231',
        courseName: 'Microeconomics-I',
        total: 2,
        correct: 1.5,
        answers: [
          { topic: 'Thinking at the margin', courseCode: 'PP231', correct: 0.5 },
          { topic: 'Gains from trade', courseCode: 'PP231', correct: 1 }
        ]
      })
      console.log(
        `[stats] level=${s.level} xp=${s.xp} (${s.levelXp}/${s.levelSpan}) streak=${s.streakDays} ` +
          `quizzes=${s.totalQuizzes} acc=${Math.round(s.accuracy * 100)}%`
      )
      const weak = await studyBrain.weakSpots()
      console.log('[stats] weak spots:', JSON.stringify(weak.map((w) => `${w.topic} ${Math.round(w.accuracy * 100)}% (n=${w.seen})`)))
      // Generate a REVIEW quiz targeting the weak topics and confirm it builds.
      const review = await studyBrain.generateQuiz({ courseCode: 'PP231', count: 3, focusTopics: weak.map((w) => w.topic) })
      console.log(`[stats] review quiz: ${review.length} questions →`, JSON.stringify(review.map((q) => q.source ?? q.concept)))
      await studyBrain.clearQuizHistory()
      console.log(`[stats] cleaned up → ${(await studyBrain.quizStats()).totalQuizzes} attempts`)
    })().catch((e) => console.error('[stats] failed:', e))
  }

  // Simulate the student path: wipe the library, reload it from the shipped
  // bundle, and prove a library miss never generates when gen is off.
  if (process.env['PGP_DEV_TEST_SHIP']) {
    void (async () => {
      console.log('[ship] imageGenEnabled =', studyBrain.imageGenEnabled())
      await studyBrain.clearLibrary()
      console.log('[ship] cleared library, count =', await studyBrain.conceptCount())
      const r = await studyBrain.importLibrary()
      console.log(`[ship] imported ${r.concepts} concepts, ${r.images} images; count = ${await studyBrain.conceptCount()}`)
      const known = (await studyBrain.listConcepts())[0]
      if (known) {
        const hit = await studyBrain.resolveIllustration({ id: 't', title: known.title, composition: '' })
        console.log(`[ship] resolve known "${known.title}": ${hit.dataUrl ? 'REUSED shipped image ✓' : 'MISS ✗ ' + hit.error}`)
      }
      const miss = await studyBrain.resolveIllustration({ id: 't2', title: 'Quantum chromodynamics of masala chai', composition: 'x' })
      console.log(`[ship] resolve unknown (gen off): ${miss.dataUrl ? 'GENERATED — BAD ✗' : 'no generation ✓ (' + miss.error + ')'}`)
    })().catch((e) => console.error('[ship] test failed:', e))
  }

  // Builder: export the concept library into the corpus bundle for shipping.
  if (process.env['PGP_DEV_PUBLISH_LIBRARY']) {
    void studyBrain
      .publishLibrary()
      .then((r) => console.log(`[lib] published ${r.concepts} concepts, ${r.images} images → ${r.dir}`))
      .catch((e) => console.error('[lib] publish failed:', e))
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
          if (ans.kind === 'slides' || ans.kind === 'text') {
            console.log(
              `[pgp] dev reply kind=${ans.kind}:`,
              ans.kind === 'slides'
                ? JSON.stringify(ans.slides.map((s) => ({ h: s.heading, ill: s.illustration?.title ?? null })))
                : ans.text.slice(0, 160)
            )
            console.log('[pgp] dev followups:', JSON.stringify(ans.followups))
            console.log('[pgp] dev sources:', ans.sources.map((s) => s.title ?? s.slug).join(' | '))
          }
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
