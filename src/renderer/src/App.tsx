import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { Tutor } from './tabs/Tutor'
import { Quiz } from './tabs/Quiz'
import { Research } from './tabs/Research'
import { Notebook } from './tabs/Notebook'
import { Projects } from './tabs/Projects'
import { Settings } from './tabs/Settings'
import { Wizard } from './Wizard'
import { useSystemStatus } from './hooks/useSystemStatus'
import type { TabId } from './tabs'
import type { CourseSummary } from '../../shared/ipc'

// The app shell. Sidebar (nav + per-tab Recents) · fixed top bar (course
// selector) · content pane. Tutor is a threaded conversation.
export function App(): JSX.Element {
  const [tab, setTab] = useState<TabId>('tutor')
  const status = useSystemStatus()
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const [openResearchId, setOpenResearchId] = useState<string | null>(null)
  const [openNotebookId, setOpenNotebookId] = useState<string | null>(null)
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)
  const [projectsVersion, setProjectsVersion] = useState(0)
  const [threadsVersion, setThreadsVersion] = useState(0)
  const [quizStatsVersion, setQuizStatsVersion] = useState(0)
  const [notebookVersion, setNotebookVersion] = useState(0)
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [course, setCourse] = useState<string>('')
  const [onboarded, setOnboarded] = useState<boolean | null>(null) // null = still loading settings
  // Explicit wizard replay (#wizard route from Settings) — state so leaving it re-renders.
  const [forceWizard, setForceWizard] = useState(() => typeof location !== 'undefined' && location.hash === '#wizard')

  useEffect(() => {
    void window.pgp.getSettings().then((s) => setOnboarded(s.onboarded))
  }, [])

  // Never show onboarding to someone whose library is already imported (the
  // builder, or a re-install over existing data) — mark them onboarded quietly.
  // An EXPLICIT replay (#wizard route) is exempt from this shortcut.
  useEffect(() => {
    if (location.hash === '#wizard') return
    if (onboarded === false && (status.stats?.chunks ?? 0) > 0) {
      void window.pgp.setSettings({ onboarded: true })
      setOnboarded(true)
    }
  }, [onboarded, status.stats])

  useEffect(() => {
    if (status.ready) void window.pgp.courses().then(setCourses)
  }, [status.ready])

  // Recents are shown for the active conversational tab, so opening one stays in
  // that tab (Tutor and Research keep separate open-thread state).
  const openThread = (id: string | null): void => {
    if (tab === 'research') setOpenResearchId(id)
    else {
      setTab('tutor')
      setOpenThreadId(id)
    }
  }
  const activeOpenThreadId = tab === 'research' ? openResearchId : openThreadId
  const threadsChanged = (): void => setThreadsVersion((v) => v + 1)

  // Choosing a course starts a new conversation in that course.
  const chooseCourse = (code: string): void => {
    setCourse(code)
    setOpenThreadId(null)
    setTab('tutor')
  }

  if (onboarded === null) return <div className="shell" />
  if (!onboarded || forceWizard) {
    return (
      <Wizard
        onDone={() => {
          if (location.hash === '#wizard') location.hash = '' // leave the replay route
          setForceWizard(false)
          setOnboarded(true)
        }}
      />
    )
  }

  return (
    <div className="shell">
      <Sidebar
        active={tab}
        onNavigate={setTab}
        engine={status.engine}
        stats={status.stats}
        openThreadId={activeOpenThreadId}
        threadsVersion={threadsVersion}
        quizStatsVersion={quizStatsVersion}
        openNotebookId={openNotebookId}
        notebookVersion={notebookVersion}
        openProjectId={openProjectId}
        projectsVersion={projectsVersion}
        onOpenThread={openThread}
        onOpenNotebook={setOpenNotebookId}
        onNotebookChanged={() => setNotebookVersion((v) => v + 1)}
        onOpenProject={setOpenProjectId}
        onProjectsChanged={() => setProjectsVersion((v) => v + 1)}
      />
      <div className="main-col">
        <TopBar tab={tab} courses={courses} course={course} onCourse={chooseCourse} />
        <main className="content">
          {tab === 'tutor' && (
            <Tutor
              ready={status.ready}
              engine={status.engine}
              courses={courses}
              course={course}
              onCourseSynced={setCourse}
              openThreadId={openThreadId}
              onOpenThread={setOpenThreadId}
              onThreadsChanged={threadsChanged}
              onCaptured={() => setNotebookVersion((v) => v + 1)}
              onGoToSettings={() => setTab('settings')}
            />
          )}
          {tab === 'quiz' && (
            <Quiz
              ready={status.ready}
              engine={status.engine}
              courses={courses}
              statsVersion={quizStatsVersion}
              onRecorded={() => setQuizStatsVersion((v) => v + 1)}
              onGoToSettings={() => setTab('settings')}
            />
          )}
          {tab === 'research' && (
            <Research
              ready={status.engine?.available ?? false}
              engine={status.engine}
              openThreadId={openResearchId}
              onOpenThread={setOpenResearchId}
              onThreadsChanged={threadsChanged}
              onCaptured={() => setNotebookVersion((v) => v + 1)}
              onGoToSettings={() => setTab('settings')}
            />
          )}
          {tab === 'notebook' && (
            <Notebook
              openId={openNotebookId}
              onOpenNotebook={setOpenNotebookId}
              onChanged={() => setNotebookVersion((v) => v + 1)}
            />
          )}
          {tab === 'projects' && (
            <Projects
              engine={status.engine}
              openId={openProjectId}
              onOpenProject={setOpenProjectId}
              onChanged={() => setProjectsVersion((v) => v + 1)}
            />
          )}
          {tab === 'settings' && <Settings status={status} />}
        </main>
      </div>
    </div>
  )
}
