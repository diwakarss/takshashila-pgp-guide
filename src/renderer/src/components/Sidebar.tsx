import { useEffect, useState } from 'react'
import { Settings as SettingsIcon, Plus, PanelLeftClose, PanelLeft, Flame } from 'lucide-react'
import { NAV_TABS, type TabId } from '../tabs'
import type { BrainStats, EngineStatus, QuizStats, Thread } from '../../../shared/ipc'

// The persistent shell (design D3): nav tabs, then — for the active tab — a
// middle panel (Recents for Tutor, gamification for Quiz), then a footer that
// stays pinned to the bottom on EVERY tab (status pills + Settings).
export function Sidebar(props: {
  active: TabId
  onNavigate: (t: TabId) => void
  engine: EngineStatus | null
  stats: BrainStats | null
  openThreadId: string | null
  threadsVersion: number
  quizStatsVersion: number
  onOpenThread: (id: string | null) => void
}): JSX.Element {
  const { active, onNavigate, engine, stats, openThreadId, threadsVersion, quizStatsVersion, onOpenThread } = props
  const [collapsed, setCollapsed] = useState(false)
  const [threads, setThreads] = useState<Thread[]>([])
  const [quiz, setQuiz] = useState<QuizStats | null>(null)

  const showRecents = active === 'tutor' || active === 'research'
  const showQuiz = active === 'quiz'

  useEffect(() => {
    if (showRecents) void window.pgp.listThreads(active).then(setThreads)
  }, [showRecents, active, threadsVersion])

  useEffect(() => {
    if (showQuiz) void window.pgp.quizStats().then(setQuiz)
  }, [showQuiz, quizStatsVersion])

  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Main">
      <div className="sidebar-top">
        {!collapsed && <div className="sidebar-wordmark">PGP Guide</div>}
        <button className="icon-btn" title={collapsed ? 'Expand' : 'Collapse'} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

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
        {showRecents && !collapsed && (
          <div className="recents">
            <button className="new-conv" onClick={() => onOpenThread(null)}>
              <Plus size={15} /> {active === 'research' ? 'New research' : 'New conversation'}
            </button>
            <div className="recents-label">Recents</div>
            <ul className="recents-list">
              {threads.length === 0 && (
                <li className="recents-empty">{active === 'research' ? 'No research yet' : 'No conversations yet'}</li>
              )}
              {threads.map((t) => (
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
