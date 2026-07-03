import { useEffect, useState } from 'react'
import { BookOpen, CheckCircle2, Cpu, KeyRound, Sparkles, RefreshCw, ExternalLink } from 'lucide-react'
import type { CorpusStatus, EngineStatus, ImportProgress } from '../../shared/ipc'

// First-launch onboarding (design D5). Welcome → connect your AI (the agent-CLI
// is the default; it is NOT an OAuth login — the student's own Claude plan via
// the Claude Code CLI) → import the course library → into the app. Skippable.
export function Wizard(props: { onDone: () => void }): JSX.Element {
  const { onDone } = props
  const [step, setStep] = useState(0)

  const finish = (engineChoice: string | null): void => {
    void window.pgp.setSettings({ onboarded: true, engineChoice }).then(onDone)
  }

  return (
    <div className="wizard">
      <div className="wizard-card">
        <div className="wizard-brand">PGP Guide</div>
        {step === 0 && <Welcome onNext={() => setStep(1)} />}
        {step === 1 && <ConnectAI onBack={() => setStep(0)} onNext={() => setStep(2)} />}
        {step === 2 && <ImportLibrary onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step === 3 && <Done onStart={() => finish('agent-cli:claude')} />}
        <div className="wizard-foot">
          <div className="wizard-dots">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`wizard-dot${i === step ? ' on' : ''}`} />
            ))}
          </div>
          <button className="btn ghost" onClick={() => finish(null)}>
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
  const [engine, setEngine] = useState<EngineStatus | null>(null)
  const [checking, setChecking] = useState(true)

  const check = (): void => {
    setChecking(true)
    void window.pgp.engineStatus().then((e) => {
      setEngine(e)
      setChecking(false)
    })
  }
  useEffect(check, [])

  const ready = engine?.available ?? false

  return (
    <div className="wizard-step">
      <Sparkles size={36} strokeWidth={1.25} style={{ color: 'var(--brand)' }} />
      <h1>Connect your AI</h1>
      <p className="muted">
        PGP Guide runs on <strong>your own AI plan</strong> — nothing is sent to us. The recommended option uses
        your Claude subscription through the Claude Code CLI.
      </p>

      <div className="wizard-ai">
        <div className={`wizard-ai-card${ready ? ' ok' : ''}`}>
          <div className="wizard-ai-head">
            <Sparkles size={18} /> Use my subscription
          </div>
          {checking ? (
            <p className="muted small">Checking for the Claude CLI…</p>
          ) : ready ? (
            <p className="wizard-ok">
              <CheckCircle2 size={16} /> Connected — {engine?.label}
            </p>
          ) : (
            <>
              <p className="muted small">
                Not detected. Install <strong>Claude Code</strong>, run <code>claude</code> once to sign in, then
                check again.
              </p>
              <a className="wizard-link" href="https://claude.com/claude-code" target="_blank" rel="noreferrer">
                Get Claude Code <ExternalLink size={12} />
              </a>
              <button className="btn wizard-recheck" onClick={check}>
                <RefreshCw size={14} /> Check again
              </button>
            </>
          )}
        </div>

        <div className="wizard-ai-alts">
          <div className="wizard-ai-alt muted">
            <KeyRound size={15} /> Paste an API key
            <span className="wizard-soon">soon</span>
          </div>
          <div className="wizard-ai-alt muted">
            <Cpu size={15} /> Run free on my PC (local)
            <span className="wizard-soon">soon</span>
          </div>
        </div>
      </div>

      <div className="wizard-actions">
        <button className="btn ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn primary" onClick={onNext} disabled={!ready} title={ready ? '' : 'Connect your AI to continue'}>
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
      ) : !status?.hasLocalCorpus ? (
        <p className="muted small">
          No local course files found yet. You can do this later from Settings once your corpus is in place.
        </p>
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
          Import {status.fileCount} lessons
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
