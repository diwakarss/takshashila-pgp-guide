import { useEffect, useState } from 'react'
import { Settings as SettingsIcon, Plus, PanelLeftClose, PanelLeft } from 'lucide-react'
import { NAV_TABS, type TabId } from '../tabs'
import type { BrainStats, EngineStatus, Thread } from '../../../shared/ipc'

// The persistent shell (design D3): nav tabs, then — for the active tab — a
// Recents list of saved conversations (Claude-style), collapsible.
export function Sidebar(props: {
  active: TabId
  onNavigate: (t: TabId) => void
  engine: EngineStatus | null
  stats: BrainStats | null
  openThreadId: string | null
  threadsVersion: number
  onOpenThread: (id: string | null) => void
}): JSX.Element {
  const { active, onNavigate, engine, stats, openThreadId, threadsVersion, onOpenThread } = props
  const [collapsed, setCollapsed] = useState(false)
  const [threads, setThreads] = useState<Thread[]>([])

  // Recents currently exist for Tutor; the same pattern serves Research later.
  const showRecents = active === 'tutor'
  useEffect(() => {
    if (showRecents) void window.pgp.listThreads('tutor').then(setThreads)
  }, [showRecents, threadsVersion])

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

      {showRecents && !collapsed && (
        <div className="recents">
          <button className="new-conv" onClick={() => onOpenThread(null)}>
            <Plus size={15} /> New conversation
          </button>
          <div className="recents-label">Recents</div>
          <ul className="recents-list">
            {threads.length === 0 && <li className="recents-empty">No conversations yet</li>}
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
