import type { Engine, EngineCapabilities, EngineMessage } from './types'
import { getApiKey } from '../services/apiKeys'

// Direct OpenAI Responses API — the API-key path for ChatGPT-side students.
// Web search uses the native web_search tool on the Responses endpoint.

const MODEL = 'gpt-5-mini' // economical default for students

type ResponsesOutput = {
  output?: { type: string; content?: { type: string; text?: string }[] }[]
  error?: { message?: string }
}

export class OpenAiApiEngine implements Engine {
  readonly capabilities: EngineCapabilities = {
    id: 'api:openai',
    label: 'OpenAI · API key',
    qualityTier: 'medium',
    supportsImages: false,
    supportsStreaming: false,
    canGradeFreeform: true,
    passesNoWriteGate: true,
    costPerToken: 1
  }

  async isAvailable(): Promise<boolean> {
    return getApiKey('openai') !== null
  }

  async complete(messages: EngineMessage[], opts: { timeoutMs?: number; webSearch?: boolean } = {}): Promise<string> {
    const key = getApiKey('openai')
    if (!key) throw new Error('No OpenAI API key configured')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180_000)
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          input: messages.map((m) => ({ role: m.role, content: m.content })),
          ...(opts.webSearch ? { tools: [{ type: 'web_search' }] } : {})
        }),
        signal: ctrl.signal
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`OpenAI API ${res.status}: ${body.slice(0, 200)}`)
      }
      const json = (await res.json()) as ResponsesOutput
      const text = (json.output ?? [])
        .filter((o) => o.type === 'message')
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === 'output_text' && c.text)
        .map((c) => c.text)
        .join('')
        .trim()
      if (!text) throw new Error(json.error?.message ?? 'OpenAI API: empty response')
      return text
    } finally {
      clearTimeout(timer)
    }
  }
}

export const openAiApiEngine = new OpenAiApiEngine()
