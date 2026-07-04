import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw, ExternalLink, CheckCircle2, Terminal } from 'lucide-react'
import type { HarnessStatus } from '../../../shared/ipc'

// Conductor-style harness cards: per CLI (Claude Code / Codex) show install +
// auth state, the signed-in account (Provider / Plan / Account / Org — read
// locally), a native-login handoff, and which harness is the active engine.

const META: Record<string, { name: string; cli: string; install: string; loginCmd: string }> = {
  'agent-cli:claude': {
    name: 'Claude',
    cli: 'Claude Code',
    install: 'https://claude.com/claude-code',
    loginCmd: 'claude /login'
  },
  'agent-cli:codex': {
    name: 'ChatGPT',
    cli: 'Codex CLI',
    install: 'https://developers.openai.com/codex/cli',
    loginCmd: 'codex login'
  }
}

export function useHarnesses(): { harnesses: HarnessStatus[] | null; refresh: () => void; checking: boolean } {
  const [harnesses, setHarnesses] = useState<HarnessStatus[] | null>(null)
  const [checking, setChecking] = useState(true)
  const refresh = (): void => {
    setChecking(true)
    void window.pgp.engineList().then((h) => {
      setHarnesses(h)
      setChecking(false)
    })
  }
  useEffect(refresh, [])
  return { harnesses, refresh, checking }
}

export function HarnessCard(props: {
  h: HarnessStatus
  onPick: (id: string) => void
  onRefresh: () => void
  compact?: boolean // wizard mode: no bin-path row
}): JSX.Element {
  const { h, onPick, onRefresh, compact } = props
  const meta = META[h.id]
  const [signInSent, setSignInSent] = useState(false)

  const signIn = async (): Promise<void> => {
    const ok = await window.pgp.engineSignIn(h.id)
    setSignInSent(ok)
  }

  return (
    <div className={`harness${h.active ? ' active' : ''}${h.available ? ' ok' : ''}`}>
      <div className="harness-head">
        <label
          className="harness-pick"
          title={h.available ? '' : 'Connect first (install + sign in below) — then this becomes selectable'}
        >
          <input type="radio" name="harness" checked={h.active} onChange={() => onPick(h.id)} disabled={!h.available} />
          <Sparkles size={16} />
          <span className="harness-name">
            {meta.name} <span className="muted small">via {meta.cli}</span>
          </span>
        </label>
        <span className={`pill ${h.available ? 'ok' : 'pending'}`}>
          {h.available ? 'Connected' : h.installed ? 'Sign in needed' : 'Not installed'}
        </span>
      </div>

      {h.available && h.account && (
        <div className="harness-detail">
          <div className="harness-row">
            <span className="label">Provider</span>
            <span>{h.account.provider}</span>
          </div>
          {h.account.plan && (
            <div className="harness-row">
              <span className="label">Plan</span>
              <span>{h.account.plan}</span>
            </div>
          )}
          {h.account.org && (
            <div className="harness-row">
              <span className="label">Org</span>
              <span>{h.account.org}</span>
            </div>
          )}
          <div className="harness-row">
            <span className="label">Account</span>
            <span>{h.account.account}</span>
          </div>
        </div>
      )}

      {!h.installed && (
        <div className="harness-hint">
          <p className="muted small">
            {meta.name} plans connect through the free <strong>{meta.cli}</strong> tool. One-time setup: install
            it, then sign in with your account.
          </p>
          <div className="harness-actions">
            <button className="btn harness-signin" onClick={() => void window.pgp.engineInstall(h.id)}>
              <Terminal size={14} /> Install {meta.cli} (opens Terminal)
            </button>
            <a className="wizard-link" href={meta.install} target="_blank" rel="noreferrer">
              What is {meta.cli}? <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}

      {h.installed && !h.available && (
        <div className="harness-hint">
          {signInSent ? (
            <p className="muted small">
              <CheckCircle2 size={13} /> A Terminal window opened with <code>{meta.loginCmd}</code> — finish signing
              in there, then press refresh.
            </p>
          ) : (
            <button className="btn harness-signin" onClick={() => void signIn()}>
              <Terminal size={14} /> Sign in ({meta.loginCmd})
            </button>
          )}
        </div>
      )}

      {!compact && h.installed && (
        <p className="muted small harness-path" title={h.binPath ?? ''}>
          {h.binPath}
        </p>
      )}

      <button className="icon-btn harness-refresh" title="Re-check" onClick={onRefresh}>
        <RefreshCw size={13} />
      </button>
    </div>
  )
}
