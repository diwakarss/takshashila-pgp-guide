import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { IPC, type AppInfo } from '../shared/ipc'
import { studyBrain } from './services/studyBrain'
import { getSettings, setSettings } from './services/settings'
import { agentCliEngine } from './engine/agentCli'
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

  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AppSettings>) => setSettings(patch))
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

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  if (process.env['PGP_DEV_BUILD_LIBRARY']) {
    void buildLibrary().catch((e) => console.error('[lib] build failed:', e))
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
      // Wizard (force via hash).
      await win.webContents.executeJavaScript(`location.hash='#wizard';location.reload()`)
      await wait(2500)
      await shoot('wizard')
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

  // Verify the projects scaffold end-to-end (self-cleaning; coach optional).
  if (process.env['PGP_DEV_PROJECTS']) {
    void (async () => {
      const ov = await studyBrain.projectsOverview()
      console.log('[proj] overview:', JSON.stringify({ assignments: ov.assignments.map((a) => a.title), capstone: ov.capstone?.title, personal: ov.personal.length }))
      const p = await studyBrain.openProject('pp231-iran-demand-supply')
      console.log(`[proj] opened "${p?.title}" step=${p?.step} deliverable="${p?.deliverable}"`)
      await studyBrain.updateProject(p!.id, { draft: 'Oil prices rose; demand for EVs shifted right.', step: 1, done: [0] })
      const ov2 = await studyBrain.projectsOverview()
      console.log('[proj] after update, assignment started/progress:', JSON.stringify(ov2.assignments.map((a) => ({ s: a.started, p: Math.round(a.progress * 100) }))))
      if (process.env['PGP_DEV_PROJECT_COACH']) {
        const c = await studyBrain.projectCoach(p!.id, 'brainstorm')
        console.log(`[proj] coach ${c.title} (blocked=${c.blocked}):`, c.markdown.slice(0, 160))
      }
      await studyBrain.deleteProject(p!.id)
      console.log('[proj] cleaned up')
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
