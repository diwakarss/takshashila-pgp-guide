import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Settings as SettingsIcon, Plus, PanelLeftClose, PanelLeft, Flame, Search, Download, RefreshCw } from 'lucide-react'
import { NAV_TABS, type TabId } from '../tabs'
import type {
  BrainStats,
  EngineStatus,
  NotebookPageSummary,
  ProjectListItem,
  ProjectsOverview,
  QuizStats,
  Thread
} from '../../../shared/ipc'

// The persistent shell (design D3): a search box, the nav tabs, then — for the
// active tab — a list panel (Recents for Tutor/Research, pages for Notebook,
// gamification for Quiz), then a footer pinned to the bottom on every tab. The
// one search box filters the active tab's list, keeping the UI uniform.
export function Sidebar(props: {
  active: TabId
  onNavigate: (t: TabId) => void
  engine: EngineStatus | null
  stats: BrainStats | null
  refreshStats: () => Promise<void>
  openThreadId: string | null
  threadsVersion: number
  quizStatsVersion: number
  openNotebookId: string | null
  notebookVersion: number
  openProjectId: string | null
  projectsVersion: number
  onOpenThread: (id: string | null) => void
  onOpenNotebook: (id: string | null) => void
  onNotebookChanged: () => void
  onOpenProject: (id: string | null) => void
  onProjectsChanged: () => void
}): JSX.Element {
  const {
    active,
    onNavigate,
    engine,
    stats,
    refreshStats,
    openThreadId,
    threadsVersion,
    quizStatsVersion,
    openNotebookId,
    notebookVersion,
    openProjectId,
    projectsVersion,
    onOpenThread,
    onOpenNotebook,
    onNotebookChanged,
    onOpenProject,
    onProjectsChanged
  } = props
  const [collapsed, setCollapsed] = useState(false)
  const MIN_W = 180
  const MAX_W = 460
  const [width, setWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem('pgp.sidebarWidth'))
    return v >= MIN_W && v <= MAX_W ? v : 210
  })
  const widthRef = useRef(width)
  const [threads, setThreads] = useState<Thread[]>([])
  const [quiz, setQuiz] = useState<QuizStats | null>(null)
  const [nbPages, setNbPages] = useState<NotebookPageSummary[]>([])
  const [projects, setProjects] = useState<ProjectsOverview | null>(null)
  const [query, setQuery] = useState('')
  // "New classes available" badge: checked shortly after launch and then every
  // half hour; clicking the pill runs the sync right here.
  const [updates, setUpdates] = useState<number>(0)
  const [syncState, setSyncState] = useState<'idle' | 'busy' | 'done'>('idle')

  useEffect(() => {
    let alive = true
    const check = (): void => {
      void window.pgp
        .corpusUpdates()
        .then((u) => {
          if (alive) setUpdates(u.pending + u.behind)
        })
        .catch(() => {})
    }
    const first = setTimeout(check, 4000)
    const every = setInterval(check, 30 * 60 * 1000)
    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(every)
    }
  }, [])

  const syncNow = async (): Promise<void> => {
    if (syncState === 'busy') return
    setSyncState('busy')
    try {
      await window.pgp.syncCorpus()
      await refreshStats()
      const u = await window.pgp.corpusUpdates()
      setUpdates(u.pending + u.behind)
      setSyncState('done')
      setTimeout(() => setSyncState('idle'), 4000)
    } catch {
      setSyncState('idle')
    }
  }

  const isThreadTab = active === 'tutor' || active === 'research'
  const showQuiz = active === 'quiz'
  const showNotebook = active === 'notebook'
  const showProjects = active === 'projects'
  const searchable = isThreadTab || showNotebook || showProjects

  // Fresh search per tab.
  useEffect(() => setQuery(''), [active])

  useEffect(() => {
    if (isThreadTab) void window.pgp.listThreads(active).then(setThreads)
  }, [isThreadTab, active, threadsVersion])

  useEffect(() => {
    if (showQuiz) void window.pgp.quizStats().then(setQuiz)
  }, [showQuiz, quizStatsVersion])

  // Notebook search is server-side (title + notes + sources).
  useEffect(() => {
    if (showNotebook) void window.pgp.notebookList(query || undefined).then(setNbPages)
  }, [showNotebook, query, notebookVersion])

  useEffect(() => {
    if (showProjects) void window.pgp.projectsOverview().then(setProjects)
  }, [showProjects, projectsVersion])

  const q = query.trim().toLowerCase()
  const shownThreads = q ? threads.filter((t) => t.title.toLowerCase().includes(q)) : threads
  const matchProj = (p: ProjectListItem): boolean => !q || p.title.toLowerCase().includes(q)

  const newNotebookPage = async (): Promise<void> => {
    const p = await window.pgp.notebookCreate()
    onOpenNotebook(p.id)
    onNotebookChanged()
  }

  const newPersonalProject = async (): Promise<void> => {
    const p = await window.pgp.createPersonalProject('')
    onOpenProject(p.id)
    onProjectsChanged()
  }

  const openProjectItem = async (item: ProjectListItem): Promise<void> => {
    const p = await window.pgp.openProject(item.id) // creates the workspace on first open
    if (p) {
      onOpenProject(p.id)
      onProjectsChanged()
    }
  }

  // Drag the right edge to resize; width persists across launches.
  const startResize = (e: ReactMouseEvent): void => {
    e.preventDefault()
    document.body.classList.add('resizing-x')
    const onMove = (ev: globalThis.MouseEvent): void => {
      const w = Math.min(MAX_W, Math.max(MIN_W, ev.clientX))
      widthRef.current = w
      setWidth(w)
    }
    const onUp = (): void => {
      document.body.classList.remove('resizing-x')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      localStorage.setItem('pgp.sidebarWidth', String(widthRef.current))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <nav
      className={`sidebar${collapsed ? ' collapsed' : ''}`}
      aria-label="Main"
      style={collapsed ? undefined : { width }}
    >
      {!collapsed && <div className="sidebar-resize" onMouseDown={startResize} title="Drag to resize" />}
      <div className="sidebar-top">
        {!collapsed && <div className="sidebar-wordmark">PGP Guide</div>}
        <button className="icon-btn" title={collapsed ? 'Expand' : 'Collapse'} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {!collapsed && searchable && (
        <div className="nb-search sidebar-search">
          <Search size={14} />
          <input
            placeholder={
              showNotebook ? 'Search notes + sources…' : showProjects ? 'Search projects…' : 'Search conversations…'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      <ul className="nav-list">
        {NAV_TABS.map((t) => {
          const Icon = t.icon
          const isActive = active === t.id
          return (
            <li key={t.id}>
              <button
                className={`nav-item${isActive ? ' active' : ''}`}
                style={isActive ? { ['--marker' as string]: t.accent } : undefined}
                aria-current={isActive ? 'page' : undefined}
                title={t.label}
                onClick={() => onNavigate(t.id)}
              >
                <Icon size={18} strokeWidth={1.75} style={{ color: isActive ? t.accent : 'var(--muted)' }} />
                {!collapsed && <span>{t.label}</span>}
              </button>
            </li>
          )
        })}
      </ul>

      {/* Middle panel — always present (even if empty) so the footer stays pinned. */}
      <div className="sidebar-mid">
        {isThreadTab && !collapsed && (
          <div className="recents">
            <button className="new-conv" onClick={() => onOpenThread(null)}>
              <Plus size={15} /> {active === 'research' ? 'New research' : 'New conversation'}
            </button>
            <div className="recents-label">Recents</div>
            <ul className="recents-list">
              {shownThreads.length === 0 && (
                <li className="recents-empty">
                  {q ? 'No matches' : active === 'research' ? 'No research yet' : 'No conversations yet'}
                </li>
              )}
              {shownThreads.map((t) => (
                <li key={t.id}>
                  <button
                    className={`recent-item${openThreadId === t.id ? ' active' : ''}`}
                    title={t.title}
                    onClick={() => onOpenThread(t.id)}
                  >
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {showNotebook && !collapsed && (
          <div className="recents">
            <button className="new-conv" onClick={newNotebookPage}>
              <Plus size={15} /> New page
            </button>
            <div className="recents-label">Pages</div>
            <ul className="recents-list">
              {nbPages.length === 0 && <li className="recents-empty">{q ? 'No matches' : 'No pages yet'}</li>}
              {nbPages.map((p) => (
                <li key={p.id}>
                  <button
                    className={`recent-item nb-recent${openNotebookId === p.id ? ' active' : ''}`}
                    title={p.title}
                    onClick={() => onOpenNotebook(p.id)}
                  >
                    <span className="nb-recent-title">{p.title}</span>
                    <span className="nb-recent-meta">
                      {p.snippets > 0 ? `${p.snippets} snippet${p.snippets === 1 ? '' : 's'} · ` : ''}
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {showProjects && !collapsed && projects && (
          <div className="recents">
            <button className="new-conv" onClick={newPersonalProject}>
              <Plus size={15} /> New project
            </button>
            <ProjectGroup
              label="Assignments"
              items={projects.assignments.filter(matchProj)}
              openId={openProjectId}
              onOpen={openProjectItem}
            />
            <ProjectGroup
              label="Capstone"
              items={projects.capstone && matchProj(projects.capstone) ? [projects.capstone] : []}
              openId={openProjectId}
              onOpen={openProjectItem}
            />
            <ProjectGroup
              label="Personal"
              items={projects.personal.filter(matchProj)}
              openId={openProjectId}
              onOpen={openProjectItem}
            />
          </div>
        )}

        {showQuiz && !collapsed && <QuizSidePanel stats={quiz} />}
      </div>

      <div className="sidebar-foot">
        {!collapsed && (
          <>
            <div className="status-pill" title="Connected AI">
              <span className={`dot ${engine?.available ? 'ok' : 'off'}`} />
              {engine ? engine.label : '…'}
            </div>
            <div className="status-pill" title="Study brain">
              <span className={`dot ${(stats?.chunks ?? 0) > 0 ? 'ok' : 'off'}`} />
              {stats ? `${stats.pages} lessons` : '…'}
            </div>
            {(updates > 0 || syncState !== 'idle') && (
              <button
                className="status-pill update-pill"
                title={
                  syncState === 'busy'
                    ? 'Adding the new classes to your brain…'
                    : `${updates} new class page${updates === 1 ? '' : 's'} available — click to add`
                }
                disabled={syncState === 'busy'}
                onClick={syncNow}
              >
                {syncState === 'busy' ? (
                  <>
                    <RefreshCw size={12} className="spin" /> Adding…
                  </>
                ) : syncState === 'done' ? (
                  <>✓ Up to date</>
                ) : (
                  <>
                    <Download size={12} /> {updates} new
                  </>
                )}
              </button>
            )}
          </>
        )}
        <button
          className={`nav-item settings${active === 'settings' ? ' active' : ''}`}
          style={active === 'settings' ? { ['--marker' as string]: 'var(--brand)' } : undefined}
          title="Settings"
          onClick={() => onNavigate('settings')}
        >
          <SettingsIcon size={18} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
    </nav>
  )
}

// A grouped section of the Projects sidebar list (Assignments / Capstone / Personal).
function ProjectGroup(props: {
  label: string
  items: ProjectListItem[]
  openId: string | null
  onOpen: (item: ProjectListItem) => void
}): JSX.Element | null {
  const { label, items, openId, onOpen } = props
  if (items.length === 0 && label !== 'Assignments') return null
  return (
    <>
      <div className="recents-label">{label}</div>
      <ul className="recents-list">
        {items.length === 0 && <li className="recents-empty">None yet</li>}
        {items.map((p) => {
          const days = p.dueAt ? Math.ceil((new Date(p.dueAt).getTime() - Date.now()) / 86_400_000) : null
          const due =
            days === null ? null : days < 0 ? 'overdue' : days === 0 ? 'due today' : `due in ${days}d`
          return (
            <li key={p.id}>
              <button
                className={`recent-item nb-recent${openId === p.id ? ' active' : ''}`}
                title={p.title}
                onClick={() => onOpen(p)}
              >
                <span className="nb-recent-title">{p.title}</span>
                <span className="nb-recent-meta">
                  {[p.courseCode, due, p.started ? `${Math.round(p.progress * 100)}%` : null]
                    .filter(Boolean)
                    .join(' · ') || p.deliverable}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

// Compact gamification for the Quiz tab: level + XP bar, streak, recent scores.
function QuizSidePanel({ stats }: { stats: QuizStats | null }): JSX.Element {
  if (!stats) return <div className="qp" />
  const pct = stats.levelSpan > 0 ? Math.round((stats.levelXp / stats.levelSpan) * 100) : 0
  return (
    <div className="qp">
      <div className="qp-level">
        <span className="qp-badge">{stats.level}</span>
        <div className="qp-level-txt">
          <div className="qp-level-name">Level {stats.level}</div>
          <div className="qp-xp">{stats.xp} XP</div>
        </div>
      </div>
      <div className="qp-bar" title={`${stats.levelXp} / ${stats.levelSpan} XP to next level`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="qp-streak" title="Consecutive days with a quiz">
        <Flame size={14} strokeWidth={2} style={{ color: stats.streakDays > 0 ? '#e07a3c' : 'var(--muted)' }} />
        {stats.streakDays > 0 ? `${stats.streakDays}-day streak` : 'No streak yet'}
      </div>

      <div className="recents-label">Recent scores</div>
      <ul className="qp-recent">
        {stats.recent.length === 0 && <li className="recents-empty">No quizzes yet</li>}
        {stats.recent.map((a) => {
          const p = a.total > 0 ? a.correct / a.total : 0
          const grade = p >= 0.8 ? 'good' : p >= 0.5 ? 'ok' : 'low'
          return (
            <li key={a.id} className="qp-recent-item">
              <span className="qp-recent-course">{a.courseCode ?? 'Mixed'}</span>
              <span className={`qp-recent-score ${grade}`}>
                {a.correct % 1 === 0 ? a.correct : a.correct.toFixed(1)}/{a.total}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
