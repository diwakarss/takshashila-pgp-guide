import { useEffect, useState } from 'react'
import { BookOpen, CheckCircle2, Sparkles } from 'lucide-react'
import { AiConnect } from './components/AiConnect'
import type { AiStatus, CorpusStatus, ImportProgress } from '../../shared/ipc'

// First-launch onboarding (design D5). Welcome → connect your AI (the agent-CLI
// is the default; it is NOT an OAuth login — the student's own Claude plan via
// the Claude Code CLI) → import the course library → into the app. Skippable.
export function Wizard(props: { onDone: () => void }): JSX.Element {
  const { onDone } = props
  const [step, setStep] = useState(0)

  // engineChoice is saved live when the student picks a harness card.
  const finish = (): void => {
    void window.pgp.setSettings({ onboarded: true }).then(onDone)
  }

  return (
    <div className="wizard">
      <div className="wizard-card">
        <div className="wizard-brand">PGP Guide</div>
        {step === 0 && <Welcome onNext={() => setStep(1)} />}
        {step === 1 && <ConnectAI onBack={() => setStep(0)} onNext={() => setStep(2)} />}
        {step === 2 && <ImportLibrary onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step === 3 && <Done onStart={finish} />}
        <div className="wizard-foot">
          <div className="wizard-dots">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`wizard-dot${i === step ? ' on' : ''}`} />
            ))}
          </div>
          <button className="btn ghost" onClick={finish}>
            Skip setup
          </button>
        </div>
      </div>
    </div>
  )
}

function Welcome({ onNext }: { onNext: () => void }): JSX.Element {
  return (
    <div className="wizard-step">
      <BookOpen size={40} strokeWidth={1.25} style={{ color: 'var(--brand)' }} />
      <h1>Your PGP study companion</h1>
      <p className="muted">
        A private, local study brain for the Post-Graduate Programme in Public Policy. Learn concepts with a
        tutor, test yourself, research any topic with policy-grade sources, keep a sourced notebook, and draft
        your assignments — all on your own machine, on your own AI plan.
      </p>
      <p className="muted small">Two quick steps: connect your AI, and load the course library.</p>
      <button className="btn primary wizard-next" onClick={onNext}>
        Get started
      </button>
    </div>
  )
}

function ConnectAI({ onBack, onNext }: { onBack: () => void; onNext: () => void }): JSX.Element {
  const [ready, setReady] = useState(false)

  const onStatus = (s: AiStatus): void => {
    setReady(s.cli.some((h) => h.available) || s.api.some((a) => a.configured) || s.local.ready)
  }

  return (
    <div className="wizard-step">
      <Sparkles size={36} strokeWidth={1.25} style={{ color: 'var(--brand)' }} />
      <h1>Choose your AI</h1>
      <p className="muted">
        Pick whichever fits you — a plan you already pay for, an API key, or a free local model. Nothing is
        sent to us; it stays between your machine and your AI.
      </p>

      <div className="wizard-ai">
        <AiConnect compact onStatus={onStatus} />
      </div>

      <div className="wizard-actions">
        <button className="btn ghost" onClick={onBack}>
          Back
        </button>
        <button
          className="btn primary"
          onClick={onNext}
          disabled={!ready}
          title={ready ? '' : 'Connect one AI to continue'}
        >
          Continue
        </button>
      </div>
    </div>
  )
}

function ImportLibrary({ onBack, onNext }: { onBack: () => void; onNext: () => void }): JSX.Element {
  const [status, setStatus] = useState<CorpusStatus | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.pgp.corpusStatus().then(setStatus)
    void window.pgp.brainStats().then((s) => {
      if (s.chunks > 0) setDone(true)
    })
    const off = window.pgp.onImportProgress(setProgress)
    return off
  }, [])

  const runImport = async (): Promise<void> => {
    setImporting(true)
    try {
      await window.pgp.importCorpus()
      setDone(true)
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }

  // Student path: no course files on this machine yet — download them from
  // the class server. The passphrase ships baked into the app, so this is
  // one click; the input only appears if no key is available (rotation edge).
  const [hasKey, setHasKey] = useState(true)
  useEffect(() => {
    void window.pgp.getSettings().then((s) => setHasKey(!!s.corpusKey))
  }, [])

  const runDownload = async (): Promise<void> => {
    setImporting(true)
    setError(null)
    try {
      if (passphrase.trim()) await window.pgp.setSettings({ corpusKey: passphrase.trim() })
      await window.pgp.syncCorpus()
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.index / progress.total) * 100) : 0

  return (
    <div className="wizard-step">
      <BookOpen size={36} strokeWidth={1.25} style={{ color: 'var(--brand)' }} />
      <h1>Load the course library</h1>
      <p className="muted">
        Your lessons are embedded locally so the tutor and quiz can work offline and privately. This runs once.
      </p>

      {done ? (
        <p className="wizard-ok">
          <CheckCircle2 size={16} /> Library ready
        </p>
      ) : !status?.hasLocalCorpus && !importing ? (
        <div className="wizard-import">
          {hasKey ? (
            <p className="muted small">Your class access is built in — one click downloads everything.</p>
          ) : (
            <>
              <p className="muted small">
                Enter the class passphrase from your welcome email to download the course library.
              </p>
              <input
                className="input"
                type="text"
                placeholder="Class passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && passphrase.trim()) void runDownload()
                }}
              />
            </>
          )}
          <button className="btn primary" disabled={!hasKey && !passphrase.trim()} onClick={() => void runDownload()}>
            Download the course library
          </button>
          {error && <p className="banner danger">{error}</p>}
        </div>
      ) : importing ? (
        <div className="wizard-import">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="muted small">
            {progress ? `Importing ${progress.index}/${progress.total} — ${progress.file}` : 'Starting…'}
          </p>
        </div>
      ) : (
        <button className="btn primary wizard-next" onClick={() => void runImport()}>
          Import {status?.fileCount ?? ''} lessons
        </button>
      )}

      <div className="wizard-actions">
        <button className="btn ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn primary" onClick={onNext}>
          {done ? 'Continue' : 'Continue anyway'}
        </button>
      </div>
    </div>
  )
}

function Done({ onStart }: { onStart: () => void }): JSX.Element {
  return (
    <div className="wizard-step">
      <CheckCircle2 size={40} strokeWidth={1.25} style={{ color: 'var(--success)' }} />
      <h1>You’re all set</h1>
      <p className="muted">
        Head to the Tutor to ask your first question, or explore Quiz, Research, Notebook, and Projects from the
        sidebar. Everything stays on your computer.
      </p>
      <button className="btn primary wizard-next" onClick={onStart}>
        Start learning
      </button>
    </div>
  )
}
