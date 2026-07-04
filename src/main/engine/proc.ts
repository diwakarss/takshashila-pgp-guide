import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { EngineMessage } from './types'

// Shared plumbing for CLI-driven engines (Claude Code, Codex).

/** Fold a message list into one prompt string (system first). */
export function flatten(messages: EngineMessage[]): string {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => (m.role === 'user' ? m.content : `Assistant: ${m.content}`))
    .join('\n\n')
  return system ? `${system}\n\n${rest}` : rest
}

/** Run a binary with stdin, resolve stdout on exit 0, reject otherwise. */
export function run(bin: string, args: string[], stdin: string | null, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let child
    try {
      // Neutral cwd so the CLI doesn't inherit a project config (CLAUDE.md etc).
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
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out.trim())
      else reject(new Error(err.trim() || `${bin} exited with code ${code}`))
    })
    if (stdin !== null) child.stdin.write(stdin)
    child.stdin.end()
  })
}
