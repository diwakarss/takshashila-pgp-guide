import { useState } from 'react'
import { CheckSquare, Search, NotebookPen, FileText } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Tutor } from './tabs/Tutor'
import { Settings } from './tabs/Settings'
import { Placeholder } from './tabs/Placeholder'
import { useSystemStatus } from './hooks/useSystemStatus'
import type { TabId } from './tabs'

// The app shell. Persistent sidebar (nav + per-tab Recents), one content pane.
// Tutor is a threaded conversation; Recents lets you reopen past threads.
export function App(): JSX.Element {
  const [tab, setTab] = useState<TabId>('tutor')
  const status = useSystemStatus()
  // Tutor conversation: which thread is open (null = a fresh one) + a counter
  // bumped whenever threads change so Recents reloads.
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const [threadsVersion, setThreadsVersion] = useState(0)

  const openThread = (id: string | null): void => {
    setTab('tutor')
    setOpenThreadId(id)
  }
  const threadsChanged = (): void => setThreadsVersion((v) => v + 1)

  return (
    <div className="shell">
      <Sidebar
        active={tab}
        onNavigate={setTab}
        engine={status.engine}
        stats={status.stats}
        openThreadId={openThreadId}
        threadsVersion={threadsVersion}
        onOpenThread={openThread}
      />
      <main className="content">
        {tab === 'tutor' && (
          <Tutor
            ready={status.ready}
            engine={status.engine}
            openThreadId={openThreadId}
            onOpenThread={setOpenThreadId}
            onThreadsChanged={threadsChanged}
            onGoToSettings={() => setTab('settings')}
          />
        )}
        {tab === 'quiz' && (
          <Placeholder
            title="Quiz"
            line="Test yourself with graded, cited questions across formats — and watch your streak grow."
            icon={CheckSquare}
            accent="#1d8a66"
          />
        )}
        {tab === 'research' && (
          <Placeholder
            title="Research"
            line="Ask across the web and the course, get cited synthesis, and highlight findings into your notebook."
            icon={Search}
            accent="#b5781a"
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
  )
}
