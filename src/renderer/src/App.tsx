import { useEffect, useState } from 'react'
import { NotebookPen, FileText } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { Tutor } from './tabs/Tutor'
import { Quiz } from './tabs/Quiz'
import { Research } from './tabs/Research'
import { Settings } from './tabs/Settings'
import { Placeholder } from './tabs/Placeholder'
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
  const [threadsVersion, setThreadsVersion] = useState(0)
  const [quizStatsVersion, setQuizStatsVersion] = useState(0)
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [course, setCourse] = useState<string>('')

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
        onOpenThread={openThread}
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
              onGoToSettings={() => setTab('settings')}
            />
          )}
          {tab === 'notebook' && (
            <Placeholder
              title="Notebook"
              line="Your pages of notes, each carrying its sources — the thread between research and your projects."
              icon={NotebookPen}
              accent="#5c6675"
            />
          )}
          {tab === 'projects' && (
            <Placeholder
              title="Projects"
              line="Draft assignments and your capstone with the scholar framework. It coaches and proofreads — you write."
              icon={FileText}
              accent="#5a4ab0"
            />
          )}
          {tab === 'settings' && <Settings status={status} />}
        </main>
      </div>
    </div>
  )
}
