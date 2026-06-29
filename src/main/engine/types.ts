// The single Engine interface behind all three BYO-LLM adapters (eng D1).
// EngineCapabilities is the ONE source of truth for "what can this engine do"
// (eng D6) — wizard warnings, the quiz free-form gate, the no-write capability
// gate, and spend estimates all read from this, never re-deriving it.

export type QualityTier = 'high' | 'medium' | 'low'

export interface EngineCapabilities {
  /** Stable adapter id, e.g. 'agent-cli:claude'. */
  id: string
  /** Plain-language label for the UI, e.g. 'Claude · your plan'. */
  label: string
  qualityTier: QualityTier
  supportsImages: boolean
  supportsStreaming: boolean
  /** Strong enough to grade free-form quiz answers (eng §8.3 gate). */
  canGradeFreeform: boolean
  /** Strong enough to be trusted on the no-write guard's capability gate (eng D2). */
  passesNoWriteGate: boolean
  /** Per-token cost in the student's currency; 0 for subscription/local. */
  costPerToken: number
}

export interface EngineMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface Engine {
  readonly capabilities: EngineCapabilities
  /** Health check (eng D4): is this engine usable right now? Never throws. */
  isAvailable(): Promise<boolean>
  /** One-shot completion. Throws on failure so callers can fall back. */
  complete(messages: EngineMessage[], opts?: { timeoutMs?: number }): Promise<string>
}
