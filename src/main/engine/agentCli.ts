import type { Engine, EngineCapabilities, EngineMessage } from './types'
import { flatten, run } from './proc'
import { resolveBin } from './resolve'

// Drives the student's Claude subscription by shelling out to the `claude`
// CLI in print mode (`claude -p`). The prompt is piped via stdin to avoid
// arg-length/escaping limits. Binary resolution handles Finder launches
// (no shell PATH) via Settings override → env → PATH → well-known locations.

export class AgentCliEngine implements Engine {
  readonly capabilities: EngineCapabilities = {
    id: 'agent-cli:claude',
    label: 'Claude · your plan',
    qualityTier: 'high',
    supportsImages: false,
    supportsStreaming: false,
    canGradeFreeform: true,
    passesNoWriteGate: true,
    costPerToken: 0
  }

  async isAvailable(): Promise<boolean> {
    const bin = resolveBin('claude')
    if (!bin) return false
    try {
      await run(bin, ['--version'], null, 8000)
      return true
    } catch {
      return false
    }
  }

  async complete(messages: EngineMessage[], opts: { timeoutMs?: number; webSearch?: boolean } = {}): Promise<string> {
    const bin = resolveBin('claude')
    if (!bin) throw new Error('Claude CLI not found')
    // `--allowedTools` lets `claude -p` use read-only web tools without an
    // interactive permission prompt; web search adds latency, so it's opt-in.
    const args = opts.webSearch ? ['-p', '--allowedTools', 'WebSearch,WebFetch'] : ['-p']
    return run(bin, args, flatten(messages), opts.timeoutMs ?? (opts.webSearch ? 150_000 : 120_000))
  }
}

export const agentCliEngine = new AgentCliEngine()
