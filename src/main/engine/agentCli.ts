import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { Engine, EngineCapabilities, EngineMessage } from './types'

// Drives the student's Claude subscription by shelling out to the `claude`
// CLI in print mode (`claude -p`), the same mechanism Conductor uses. The
// full prompt is piped via stdin to avoid arg-length/escaping limits.
//
// Fragility is real (eng D4): the CLI may be absent, unauthenticated, or
// change between versions — so isAvailable() gates use and complete() throws
// cleanly so the caller can surface a plain-language fallback.

const CLAUDE_BIN = process.env['PGP_CLAUDE_BIN'] ?? 'claude'

function flatten(messages: EngineMessage[]): string {
  // `claude -p` takes a single prompt; fold the system message in as a
  // leading instruction block.
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => (m.role === 'user' ? m.content : `Assistant: ${m.content}`))
    .join('\n\n')
  return system ? `${system}\n\n${rest}` : rest
}

function run(bin: string, args: string[], stdin: string | null, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let child
    try {
      // Run from a neutral cwd so the CLI doesn't inherit a project CLAUDE.md.
      // (A user-global ~/.claude config can still apply — isolating that fully
      // is part of the D4 agent-CLI hardening: pass an explicit system prompt /
      // config-free flag once we pin a CLI version.)
      child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: tmpdir() })
    } catch (e) {
      reject(e)
      return
    }
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`engine timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      // ENOENT = the CLI isn't on PATH (common when Electron is launched from
      // Finder and doesn't inherit the shell PATH).
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out.trim())
      else reject(new Error(err.trim() || `${bin} exited with code ${code}`))
    })
    if (stdin !== null) {
      child.stdin.write(stdin)
    }
    child.stdin.end()
  })
}

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
    try {
      await run(CLAUDE_BIN, ['--version'], null, 8000)
      return true
    } catch {
      return false
    }
  }

  async complete(messages: EngineMessage[], opts: { timeoutMs?: number; webSearch?: boolean } = {}): Promise<string> {
    const prompt = flatten(messages)
    // `--allowedTools` lets `claude -p` use read-only web tools without an
    // interactive permission prompt; web search adds latency, so it's opt-in.
    const args = opts.webSearch ? ['-p', '--allowedTools', 'WebSearch,WebFetch'] : ['-p']
    return run(CLAUDE_BIN, args, prompt, opts.timeoutMs ?? (opts.webSearch ? 150_000 : 120_000))
  }
}

export const agentCliEngine = new AgentCliEngine()
