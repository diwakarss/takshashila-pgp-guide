import { existsSync } from 'node:fs'
import { totalmem } from 'node:os'
import type { Engine, EngineCapabilities, EngineMessage } from './types'
import { getSettings } from '../services/settings'

// Local, free path: Ollama on localhost. No account, no cost, fully private —
// with honest trade-offs (smaller model, no web search).

const BASE = 'http://127.0.0.1:11434'

/** Recommend the strongest model that comfortably fits this machine's memory.
 *  A 32GB Mac Studio and an 8GB laptop deserve different defaults. */
export function recommendedModel(): { model: string; sizeGb: number; reason: string } {
  const gb = totalmem() / 1073741824
  if (gb >= 30) return { model: 'gpt-oss:20b', sizeGb: 14, reason: `strong 20B model — fits your ${Math.round(gb)} GB machine` }
  if (gb >= 16) return { model: 'qwen3:8b', sizeGb: 5.2, reason: `capable 8B model — fits your ${Math.round(gb)} GB machine` }
  return { model: 'llama3.2:3b', sizeGb: 2, reason: 'small model for lighter machines' }
}

export function ollamaModel(): string {
  return getSettings().localModel ?? recommendedModel().model
}

const fakeMissing = (): boolean => (process.env['PGP_DEV_FAKE_MISSING'] ?? '').includes('ollama')

export function ollamaInstalled(): boolean {
  if (fakeMissing()) return false
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA'] ?? ''
    return (
      (!!local && existsSync(`${local}\\Programs\\Ollama\\ollama.exe`)) ||
      existsSync('C:\\Program Files\\Ollama\\ollama.exe')
    )
  }
  return (
    existsSync('/opt/homebrew/bin/ollama') ||
    existsSync('/usr/local/bin/ollama') ||
    existsSync('/Applications/Ollama.app')
  )
}

export async function ollamaRunning(): Promise<boolean> {
  if (fakeMissing()) return false
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(2500) })
    return res.ok
  } catch {
    return false
  }
}

export async function ollamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return []
    const json = (await res.json()) as { models?: { name: string }[] }
    return (json.models ?? []).map((m) => m.name)
  } catch {
    return []
  }
}

/** Pull a model with NDJSON progress (completed/total bytes). */
export async function ollamaPull(
  model: string,
  onProgress: (p: { status: string; completed?: number; total?: number }) => void
): Promise<void> {
  const res = await fetch(`${BASE}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true })
  })
  if (!res.ok || !res.body) throw new Error(`ollama pull failed: ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      try {
        const j = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string }
        if (j.error) throw new Error(j.error)
        onProgress({ status: j.status ?? '', completed: j.completed, total: j.total })
      } catch (e) {
        if (e instanceof Error && !line.startsWith('{')) continue
        throw e
      }
    }
  }
}

export class OllamaEngine implements Engine {
  readonly capabilities: EngineCapabilities = {
    id: 'local:ollama',
    label: 'Local · Ollama',
    qualityTier: 'low',
    supportsImages: false,
    supportsStreaming: false,
    canGradeFreeform: true,
    passesNoWriteGate: true,
    costPerToken: 0
  }

  async isAvailable(): Promise<boolean> {
    if (!(await ollamaRunning())) return false
    const models = await ollamaModels()
    const want = ollamaModel()
    return models.some((m) => m === want || m.startsWith(want.split(':')[0]))
  }

  async complete(messages: EngineMessage[], opts: { timeoutMs?: number; webSearch?: boolean } = {}): Promise<string> {
    // No web on local — be honest in-context instead of silently fabricating.
    const msgs = opts.webSearch
      ? [
          ...messages,
          {
            role: 'system' as const,
            content:
              'NOTE: web search is NOT available on this local model. Answer from prior knowledge only, clearly flag uncertainty and dates, and never invent sources or URLs.'
          }
        ]
      : messages
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 300_000)
    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel(),
          messages: msgs.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
          options: { num_ctx: 16384 }
        }),
        signal: ctrl.signal
      })
      if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const json = (await res.json()) as { message?: { content?: string } }
      return (json.message?.content ?? '').trim()
    } finally {
      clearTimeout(timer)
    }
  }
}

export const ollamaEngine = new OllamaEngine()
