import { Settings as SettingsIcon } from 'lucide-react'
import { NAV_TABS, type TabId } from '../tabs'
import type { BrainStats, EngineStatus } from '../../../shared/ipc'

// The persistent shell (design D3): identical on every surface. Wordmark, the
// five nav items (active = surface fill + tab-accent left marker), and a bottom
// block showing which AI is connected, the brain status, and Settings.
export function Sidebar(props: {
  active: TabId
  onNavigate: (t: TabId) => void
  engine: EngineStatus | null
  stats: BrainStats | null
}): JSX.Element {
  const { active, onNavigate, engine, stats } = props
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar-wordmark">PGP Guide</div>

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
                onClick={() => onNavigate(t.id)}
              >
                <Icon size={18} strokeWidth={1.75} style={{ color: isActive ? t.accent : 'var(--muted)' }} />
                <span>{t.label}</span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="sidebar-foot">
        <div className="status-pill" title="Connected AI">
          <span className={`dot ${engine?.available ? 'ok' : 'off'}`} />
          {engine ? engine.label : '…'}
        </div>
        <div className="status-pill" title="Study brain">
          <span className={`dot ${(stats?.chunks ?? 0) > 0 ? 'ok' : 'off'}`} />
          {stats ? `${stats.pages} lessons` : '…'}
        </div>
        <button
          className={`nav-item settings${active === 'settings' ? ' active' : ''}`}
          style={active === 'settings' ? { ['--marker' as string]: 'var(--brand)' } : undefined}
          aria-current={active === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate('settings')}
        >
          <SettingsIcon size={18} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
          <span>Settings</span>
        </button>
      </div>
    </nav>
  )
}
