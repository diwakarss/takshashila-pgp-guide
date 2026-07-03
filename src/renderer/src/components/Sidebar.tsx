import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Settings as SettingsIcon, Plus, PanelLeftClose, PanelLeft, Flame, Search } from 'lucide-react'
import { NAV_TABS, type TabId } from '../tabs'
import type { BrainStats, EngineStatus, NotebookPageSummary, QuizStats, Thread } from '../../../shared/ipc'

// The persistent shell (design D3): a search box, the nav tabs, then — for the
// active tab — a list panel (Recents for Tutor/Research, pages for Notebook,
// gamification for Quiz), then a footer pinned to the bottom on every tab. The
// one search box filters the active tab's list, keeping the UI uniform.
export function Sidebar(props: {
  active: TabId
  onNavigate: (t: TabId) => void
  engine: EngineStatus | null
  stats: BrainStats | null
  openThreadId: string | null
  threadsVersion: number
  quizStatsVersion: number
  openNotebookId: string | null
  notebookVersion: number
  onOpenThread: (id: string | null) => void
  onOpenNotebook: (id: string | null) => void
  onNotebookChanged: () => void
}): JSX.Element {
  const {
    active,
    onNavigate,
    engine,
    stats,
    openThreadId,
    threadsVersion,
    quizStatsVersion,
    openNotebookId,
    notebookVersion,
    onOpenThread,
    onOpenNotebook,
    onNotebookChanged
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
  const [query, setQuery] = useState('')

  const isThreadTab = active === 'tutor' || active === 'research'
  const showQuiz = active === 'quiz'
  const showNotebook = active === 'notebook'
  const searchable = isThreadTab || showNotebook

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

  const q = query.trim().toLowerCase()
  const shownThreads = q ? threads.filter((t) => t.title.toLowerCase().includes(q)) : threads

  const newNotebookPage = async (): Promise<void> => {
    const p = await window.pgp.notebookCreate()
    onOpenNotebook(p.id)
    onNotebookChanged()
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
            placeholder={showNotebook ? 'Search notes + sources…' : 'Search conversations…'}
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
