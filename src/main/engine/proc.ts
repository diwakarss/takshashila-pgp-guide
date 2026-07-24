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
      // Windows npm shims (.cmd/.bat) can't be spawned directly (EINVAL since
      // the Node CVE fix). shell:true is Node's own documented fix for this —
      // it routes through cmd.exe AND applies Node's own battle-tested
      // argument escaping. A hand-rolled '"bin" "arg1" "arg2"' + verbatim-args
      // scheme was tried here before and broke on Codex's longer argv (cmd.exe
      // saw one giant quoted blob instead of separate tokens and reported the
      // whole thing as "not recognized" — only surfaced once Codex became
      // selectable, since Claude installs as a native .exe on Windows and
      // never took this branch). No injection risk: every arg here is a fixed
      // literal or an internally-generated path, never raw user/model text
      // (the prompt goes over stdin, never through argv).
      const isCmdShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
      // Neutral cwd so the CLI doesn't inherit a project config (CLAUDE.md etc).
      // PGP_APP_CALL marks this as a programmatic call so user-level CLI hooks
      // (e.g. persona injectors) stand down — one polluted the coach's prompts.
      child = spawn(bin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: tmpdir(),
        env: { ...process.env, PGP_APP_CALL: '1' },
        windowsHide: true,
        shell: isCmdShim
      })
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
