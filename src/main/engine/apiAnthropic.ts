import type { Engine, EngineCapabilities, EngineMessage } from './types'
import { getApiKey } from '../services/apiKeys'

// Direct Anthropic Messages API — for students with an API key instead of a
// subscription. Web search uses Anthropic's server-side web_search tool, so the
// Research tab keeps working on this path.

const MODEL = 'claude-sonnet-4-5' // strong + economical default for students

export class AnthropicApiEngine implements Engine {
  readonly capabilities: EngineCapabilities = {
    id: 'api:anthropic',
    label: 'Claude · API key',
    qualityTier: 'high',
    supportsImages: false,
    supportsStreaming: false,
    canGradeFreeform: true,
    passesNoWriteGate: true,
    costPerToken: 1 // >0 = paid per call (budget UI later)
  }

  async isAvailable(): Promise<boolean> {
    return getApiKey('anthropic') !== null
  }

  async complete(messages: EngineMessage[], opts: { timeoutMs?: number; webSearch?: boolean } = {}): Promise<string> {
    const key = getApiKey('anthropic')
    if (!key) throw new Error('No Anthropic API key configured')
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const rest = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180_000)
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 8192,
          ...(system ? { system } : {}),
          messages: rest.length ? rest : [{ role: 'user', content: 'Hello' }],
          ...(opts.webSearch ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }] } : {})
        }),
        signal: ctrl.signal
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`)
      }
      const json = (await res.json()) as { content?: { type: string; text?: string }[] }
      return (json.content ?? [])
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('')
        .trim()
    } finally {
      clearTimeout(timer)
    }
  }
}

export const anthropicApiEngine = new AnthropicApiEngine()
