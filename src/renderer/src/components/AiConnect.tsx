import { useEffect, useRef, useState } from 'react'
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
  { key: 'plan', icon: UserRound, title: 'My account', blurb: 'I pay for Claude or ChatGPT' },
  { key: 'api', icon: KeyRound, title: 'API key', blurb: 'I have a developer key' },
  { key: 'local', icon: Cpu, title: 'Local (free)', blurb: 'No account — run it on my computer' }
]

// Plain-language guidance per method — most of the cohort is non-technical.
const EXPLAIN: Record<Method, JSX.Element> = {
  plan: (
    <p className="muted small aic-explain">
      <strong>Best quality, no extra cost</strong> if you already subscribe to Claude (claude.ai) or ChatGPT
      (chatgpt.com). One-time setup: we install the provider’s free helper tool, you sign in with your normal
      account, done. Your questions use your existing plan.
    </p>
  ),
  api: (
    <p className="muted small aic-explain">
      An API key is a <strong>pay-per-use developer pass</strong> — you add credit with the provider and each
      question costs a fraction of a rupee. We support <strong>Anthropic</strong> and <strong>OpenAI</strong>.
      Get a key at console.anthropic.com or platform.openai.com (→ API keys). The app has no spend meter yet, so
      glance at your provider dashboard now and then.
    </p>
  ),
  local: (
    <p className="muted small aic-explain">
      <strong>Free, private, works offline</strong> — a model runs on this computer, so nothing is sent anywhere
      and there’s nothing to pay. Trade-off: simpler answers than the paid options, and no live web research.
      We pick a model that fits your machine.
    </p>
  )
}

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

      {method && EXPLAIN[method]}

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
  const inputRef = useRef<HTMLInputElement>(null)

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
        <label
          className="harness-pick"
          title={a.configured ? '' : 'Paste your key and press “Save & test” — a working key is selected automatically'}
          onClick={() => {
            if (!a.configured) inputRef.current?.focus() // dead radio → guide to the real first step
          }}
        >
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
          <p className="muted small aic-key-hint">
            Step 1: paste your key · Step 2: <strong>Save &amp; test</strong> (we verify it with one tiny
            question, then select it for you).
          </p>
          <div className="ask-row">
            <input
              ref={inputRef}
              className="input"
              type="password"
              placeholder={a.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && key.trim() && !testing && void save()}
            />
            <button className="btn primary" disabled={!key.trim() || testing} onClick={() => void save()}>
              {testing ? 'Testing…' : 'Save & test'}
            </button>
          </div>
          <a
            className="wizard-link"
            href={a.provider === 'anthropic' ? 'https://console.anthropic.com/settings/keys' : 'https://platform.openai.com/api-keys'}
            target="_blank"
            rel="noreferrer"
          >
            Where do I get a key? <ExternalLink size={11} />
          </a>
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
          <label
            className="harness-pick"
            title={local.ready ? '' : 'Finish the setup below — then this becomes selectable'}
          >
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
          Recommended for you: <strong>{local.recommendedModel}</strong> — {local.recommendedReason}.
        </p>

        {!local.installed && (
          <div className="harness-actions">
            <button className="btn harness-signin" onClick={() => void window.pgp.engineInstall(local.engineId)}>
              <Terminal size={14} /> Install Ollama
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
                <Download size={14} /> Download {local.recommendedModel} (~{local.recommendedSizeGb} GB, once)
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
