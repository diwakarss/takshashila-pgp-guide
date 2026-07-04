import { useEffect, useState } from 'react'
import { UserRound, KeyRound, Cpu, CheckCircle2, RefreshCw, Terminal, Trash2, Download, ExternalLink } from 'lucide-react'
import { HarnessCard } from './Harnesses'
import type { AiStatus, PullProgress } from '../../../shared/ipc'

// One component for "connect your AI", used by the wizard and Settings. Three
// paths for three kinds of students:
//   My account — has a Claude/ChatGPT plan (CLI does the sign-in, one-time)
//   API key    — has a developer key instead
//   Local      — no account at all: free, private Ollama on their machine
// Whatever they pick becomes the active engine; changeable any time.

type Method = 'plan' | 'api' | 'local'

const METHODS: { key: Method; icon: typeof UserRound; title: string; blurb: string }[] = [
  { key: 'plan', icon: UserRound, title: 'My account', blurb: 'Use your Claude or ChatGPT plan' },
  { key: 'api', icon: KeyRound, title: 'API key', blurb: 'Paste an Anthropic or OpenAI key' },
  { key: 'local', icon: Cpu, title: 'Local (free)', blurb: 'Run a model on this computer' }
]

function familyOf(engineId: string): Method {
  if (engineId.startsWith('api:')) return 'api'
  if (engineId.startsWith('local:')) return 'local'
  return 'plan'
}

export function AiConnect(props: { compact?: boolean; onStatus?: (s: AiStatus) => void }): JSX.Element {
  const { compact, onStatus } = props
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [method, setMethod] = useState<Method | null>(null)

  const refresh = (): void => {
    void window.pgp.aiStatus().then((s) => {
      setStatus(s)
      onStatus?.(s)
      setMethod((m) => m ?? familyOf(s.activeId))
    })
  }
  useEffect(refresh, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (engineId: string): void => {
    void window.pgp.setSettings({ engineChoice: engineId }).then(refresh)
  }

  if (!status) return <p className="muted small">Checking your AI options…</p>

  return (
    <div className="aic">
      <div className="aic-methods">
        {METHODS.map(({ key, icon: Icon, title, blurb }) => (
          <button
            key={key}
            className={`aic-method${method === key ? ' on' : ''}`}
            onClick={() => setMethod(key)}
          >
            <Icon size={18} />
            <span className="aic-method-title">{title}</span>
            <span className="aic-method-blurb muted small">{blurb}</span>
          </button>
        ))}
      </div>

      {method === 'plan' && (
        <div className="aic-panel">
          {status.cli.map((h) => (
            <HarnessCard key={h.id} h={h} onPick={pick} onRefresh={refresh} compact={compact} />
          ))}
        </div>
      )}

      {method === 'api' && (
        <div className="aic-panel">
          {status.api.map((a) => (
            <ApiCard key={a.provider} a={a} onPick={pick} onChanged={refresh} />
          ))}
          <p className="muted small">Keys are encrypted with your computer’s keychain and never leave it.</p>
        </div>
      )}

      {method === 'local' && <LocalPanel status={status} onPick={pick} onChanged={refresh} />}
    </div>
  )
}

// ── API key card ───────────────────────────────────────────────────────────
function ApiCard(props: {
  a: AiStatus['api'][number]
  onPick: (id: string) => void
  onChanged: () => void
}): JSX.Element {
  const { a, onPick, onChanged } = props
  const [key, setKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setTesting(true)
    setError(null)
    const res = await window.pgp.aiSetApiKey(a.provider, key)
    setTesting(false)
    if (res.ok) {
      setKey('')
      onPick(a.engineId) // a freshly proven key becomes the active engine
    } else {
      setError(res.error ?? 'The key didn’t work.')
    }
  }

  const remove = async (): Promise<void> => {
    await window.pgp.aiClearApiKey(a.provider)
    onChanged()
  }

  return (
    <div className={`harness${a.active ? ' active' : ''}${a.configured ? ' ok' : ''}`}>
      <div className="harness-head">
        <label className="harness-pick">
          <input type="radio" name="harness" checked={a.active} onChange={() => onPick(a.engineId)} disabled={!a.configured} />
          <KeyRound size={15} />
          <span className="harness-name">
            {a.label} <span className="muted small">· {a.model}</span>
          </span>
        </label>
        <span className={`pill ${a.configured ? 'ok' : 'pending'}`}>{a.configured ? 'Key saved' : 'No key'}</span>
      </div>
      {a.configured ? (
        <div className="harness-hint aic-keyrow">
          <span className="muted small">Key: {a.keyMasked}</span>
          <button className="icon-btn" title="Remove key" onClick={() => void remove()}>
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <div className="harness-hint">
          <div className="ask-row">
            <input
              className="input"
              type="password"
              placeholder={a.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="btn primary" disabled={!key.trim() || testing} onClick={() => void save()}>
              {testing ? 'Testing…' : 'Save & test'}
            </button>
          </div>
          {error && <p className="banner danger">{error}</p>}
        </div>
      )}
    </div>
  )
}

// ── Local (Ollama) panel ───────────────────────────────────────────────────
function LocalPanel(props: { status: AiStatus; onPick: (id: string) => void; onChanged: () => void }): JSX.Element {
  const { status, onPick, onChanged } = props
  const local = status.local
  const [pulling, setPulling] = useState(false)
  const [progress, setProgress] = useState<PullProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pull = async (): Promise<void> => {
    setPulling(true)
    setError(null)
    const off = window.pgp.onOllamaPullProgress(setProgress)
    try {
      await window.pgp.aiOllamaPull(local.recommendedModel)
      onPick(local.engineId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      off()
      setPulling(false)
      setProgress(null)
      onChanged()
    }
  }

  const pct = progress?.total ? Math.round(((progress.completed ?? 0) / progress.total) * 100) : null

  return (
    <div className="aic-panel">
      <div className={`harness${local.active ? ' active' : ''}${local.ready ? ' ok' : ''}`}>
        <div className="harness-head">
          <label className="harness-pick">
            <input type="radio" name="harness" checked={local.active} onChange={() => onPick(local.engineId)} disabled={!local.ready} />
            <Cpu size={15} />
            <span className="harness-name">
              Ollama <span className="muted small">· {local.recommendedModel}</span>
            </span>
          </label>
          <span className={`pill ${local.ready ? 'ok' : 'pending'}`}>
            {local.ready ? 'Ready' : local.running ? 'Model needed' : local.installed ? 'Not running' : 'Not installed'}
          </span>
        </div>

        <p className="muted small harness-hint">
          Free and fully private — answers come from a small model on this computer. No web search, and expect
          simpler answers than the account options.
        </p>

        {!local.installed && (
          <div className="harness-actions">
            <button className="btn harness-signin" onClick={() => void window.pgp.engineInstall(local.engineId)}>
              <Terminal size={14} /> Install Ollama (opens Terminal)
            </button>
            <a className="wizard-link" href="https://ollama.com/download" target="_blank" rel="noreferrer">
              Or download the app <ExternalLink size={11} />
            </a>
          </div>
        )}

        {local.installed && !local.running && (
          <div className="harness-actions">
            <p className="muted small">Ollama is installed but not running — open the Ollama app, then re-check.</p>
            <button className="btn harness-signin" onClick={onChanged}>
              <RefreshCw size={14} /> Check again
            </button>
          </div>
        )}

        {local.running && !local.ready && (
          <div className="harness-actions">
            {pulling ? (
              <div className="wizard-import">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${pct ?? 5}%` }} />
                </div>
                <p className="muted small">
                  {progress?.status ?? 'Starting…'}
                  {pct !== null ? ` · ${pct}%` : ''}
                </p>
              </div>
            ) : (
              <button className="btn primary harness-signin" onClick={() => void pull()}>
                <Download size={14} /> Download {local.recommendedModel} (~2 GB, once)
              </button>
            )}
            {error && <p className="banner danger">{error}</p>}
          </div>
        )}

        {local.ready && (
          <p className="wizard-ok">
            <CheckCircle2 size={15} /> {local.models.find((m) => m.startsWith(local.recommendedModel.split(':')[0])) ?? local.recommendedModel} is ready
          </p>
        )}
      </div>
    </div>
  )
}
