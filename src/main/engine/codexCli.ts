import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { Engine, EngineCapabilities, EngineMessage } from './types'
import { flatten, run } from './proc'
import { resolveBin } from './resolve'
import { codexAccount } from './accounts'

// Drives the student's ChatGPT subscription via the Codex CLI in non-
// interactive mode. Verified recipe (codex-cli 0.142):
//   codex [--search] exec --skip-git-repo-check --ephemeral -s read-only \
//         --color never -o <file> -            (prompt via stdin)
// -o writes ONLY the agent's final message (no transcript parsing);
// --ephemeral keeps sessions off disk; read-only sandbox as belt+braces —
// we never ask it to run commands. --search enables live web search.

export class CodexCliEngine implements Engine {
  readonly capabilities: EngineCapabilities = {
    id: 'agent-cli:codex',
    label: 'ChatGPT · your plan',
    qualityTier: 'high',
    supportsImages: false,
    supportsStreaming: false,
    canGradeFreeform: true,
    passesNoWriteGate: true,
    costPerToken: 0
  }

  async isAvailable(): Promise<boolean> {
    const bin = resolveBin('codex')
    if (!bin) return false
    // Spawning `codex login status` (a real auth/token check, not a cheap
    // --version-style probe) through a Windows .cmd shim proved unreliable —
    // it never returned within budget even right after a successful
    // interactive login, permanently stuck on "Sign in needed". auth.json is
    // the same local source that already powers the account display once
    // available flips true, so it's an equally trustworthy signal — and a
    // pure file read, immune to CLI-subprocess flakiness on any platform.
    return codexAccount() !== null
  }

  async complete(messages: EngineMessage[], opts: { timeoutMs?: number; webSearch?: boolean } = {}): Promise<string> {
    const bin = resolveBin('codex')
    if (!bin) throw new Error('Codex CLI not found')
    const outFile = join(tmpdir(), `pgp-codex-${randomUUID()}.txt`)
    const args = [
      ...(opts.webSearch ? ['--search'] : []),
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '-s',
      'read-only',
      // Medium deliberation: high-effort Codex browses far too long for a chat
      // UX (measured: evidence research blew a 6-minute budget on high).
      '-c',
      'model_reasoning_effort=medium',
      '--color',
      'never',
      '-o',
      outFile,
      '-'
    ]
    try {
      await run(bin, args, flatten(messages), opts.timeoutMs ?? (opts.webSearch ? 180_000 : 120_000))
      return readFileSync(outFile, 'utf8').trim()
    } finally {
      try {
        unlinkSync(outFile)
      } catch {
        /* already gone */
      }
    }
  }
}

export const codexCliEngine = new CodexCliEngine()
